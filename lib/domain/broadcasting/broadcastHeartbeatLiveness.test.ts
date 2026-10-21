import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAME_MIN_FPS,
  isFpsAboveThreshold,
  type MotionSample,
  summarizeFps,
  VIDEO_MIN_FPS,
} from "../../../scripts/check-stream";
import {
  countChangedPixels,
  DEFAULT_COLOR_KEY_THRESHOLD,
  HEARTBEAT_CHANNEL_TOLERANCE,
  HEARTBEAT_MIN_CHANGED_RATIO,
  type HeartbeatBandSpec,
  parseHeartbeatBandSpec,
  sampleHeartbeatFrame,
  simulateHeartbeatLiveness,
} from "./broadcastHeartbeatLiveness";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../../../src/index.css"), "utf8");
const detectorSource = readFileSync(
  join(here, "../../../scripts/check-stream.ts"),
  "utf8",
);

const FPS = 30;
const WINDOW_MS = 10_000;
const SAMPLE_WIDTH = 128;
const SAMPLE_HEIGHT = 72;
const GAME_WIDTH_RATIO = 0.6;

/**
 * 帯だけの絵を検知側の `MotionSample` に書き換え、検知側の関数
 * (`summarizeFps` / `isFpsAboveThreshold`) で判定する。
 *
 * 検知側と同じ関数を使うことで、この検証が「検知側が実際に数えるもの」と
 * 一致することを担保する（`scripts/check-stream.ts` は owner 契約 #807 で
 * 改変できないので、判定ロジックを複製せずに済む）。
 */
const evaluateThroughDetector = (
  spec: HeartbeatBandSpec,
  options: { colorKey?: { threshold: number } } = {},
): { videoMinFps: number; gameMinFps: number } => {
  const frameCount = Math.round((WINDOW_MS / 1000) * FPS);
  const gameWidth = Math.floor(SAMPLE_WIDTH * GAME_WIDTH_RATIO);
  const samples: MotionSample[] = [];
  let previous: ReturnType<typeof sampleHeartbeatFrame> | undefined;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const elapsedMs = (frame * 1000) / FPS;
    const current = sampleHeartbeatFrame(spec, {
      elapsedMs,
      colorKey: options.colorKey,
      sampleWidth: SAMPLE_WIDTH,
      sampleHeight: SAMPLE_HEIGHT,
    });
    if (previous) {
      const changed = countChangedPixels(previous, current);
      const gameChanged = countChangedPixels(previous, current, undefined, {
        from: 0,
        to: gameWidth,
      });
      samples.push({
        elapsedMs,
        wholeChanged:
          changed / (SAMPLE_WIDTH * SAMPLE_HEIGHT) >
          HEARTBEAT_MIN_CHANGED_RATIO,
        gameChanged:
          gameChanged / (gameWidth * SAMPLE_HEIGHT) >
          HEARTBEAT_MIN_CHANGED_RATIO,
      });
    }
    previous = current;
  }
  const video = summarizeFps(
    samples,
    (sample) => sample.wholeChanged,
    1_000,
    WINDOW_MS,
  );
  const game = summarizeFps(
    samples,
    (sample) => sample.gameChanged,
    1_000,
    WINDOW_MS,
  );
  return { videoMinFps: video.minFps, gameMinFps: game.minFps };
};

/** 修正前（2026-10-21 22:27 まで）の帯の CSS。 */
const legacyCss = `
@keyframes broadcast-heartbeat-sweep {
  from {
    transform: translateY(-12vh);
  }
  to {
    transform: translateY(112vh);
  }
}

.broadcast-heartbeat {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 6vh;
  pointer-events: none;
  z-index: 50;
  background: linear-gradient(
    to bottom,
    rgba(16, 185, 129, 0) 0%,
    rgba(16, 185, 129, 0.55) 38%,
    rgba(255, 255, 255, 0.6) 50%,
    rgba(16, 185, 129, 0.55) 62%,
    rgba(16, 185, 129, 0) 100%
  );
  animation: broadcast-heartbeat-sweep 2.4s linear infinite;
  will-change: transform;
}
`;

describe("broadcast heartbeat liveness", () => {
  it("parses the shipped band out of the stylesheet", () => {
    const spec = parseHeartbeatBandSpec(css);
    expect(spec.fromVh).toBe(-2);
    expect(spec.toVh).toBe(92);
    expect(spec.heightVh).toBe(6);
    expect(spec.durationMs).toBe(2400);
    // 不透明な白芯（OBS の黒 Color Key に削られない部分）。
    const opaque = spec.stops.filter((stop) => stop.color.a === 1);
    expect(opaque.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the band inside the captured area at every step of the sweep", () => {
    const spec = parseHeartbeatBandSpec(css);
    // 帯の上端が画面の上端より上に出ても、帯の一部は画面内に残る。
    expect(spec.fromVh).toBeGreaterThanOrEqual(-spec.heightVh);
    expect(spec.toVh).toBeLessThanOrEqual(100);
  });

  it("satisfies the detector's thresholds on its own", () => {
    const spec = parseHeartbeatBandSpec(css);
    const { videoMinFps, gameMinFps } = evaluateThroughDetector(spec);
    expect(isFpsAboveThreshold(videoMinFps, VIDEO_MIN_FPS)).toBe(true);
    expect(isFpsAboveThreshold(gameMinFps, GAME_MIN_FPS)).toBe(true);
  });

  it("still satisfies the detector's thresholds after OBS's black color key", () => {
    // OBS の Comment browser_source には黒の Color Key が掛かっている。
    // 半透明の帯は key で消えて「止まった」判定になることがあるので、
    // key を掛けた状態でも閾値を超えることを確かめる。
    const spec = parseHeartbeatBandSpec(css);
    const { videoMinFps, gameMinFps } = evaluateThroughDetector(spec, {
      colorKey: { threshold: DEFAULT_COLOR_KEY_THRESHOLD },
    });
    expect(isFpsAboveThreshold(videoMinFps, VIDEO_MIN_FPS)).toBe(true);
    expect(isFpsAboveThreshold(gameMinFps, GAME_MIN_FPS)).toBe(true);
  });

  it("keeps a wide margin over the detector's changed-pixel ratio", () => {
    const spec = parseHeartbeatBandSpec(css);
    const summary = simulateHeartbeatLiveness(spec, {
      colorKey: { threshold: DEFAULT_COLOR_KEY_THRESHOLD },
    });
    // 1 フレーム中最悪でも、判定の閾値 0.001 に対して桁違いに大きい。
    expect(summary.minChangedRatio).toBeGreaterThan(
      HEARTBEAT_MIN_CHANGED_RATIO * 10,
    );
    expect(summary.minGameChangedRatio).toBeGreaterThan(
      HEARTBEAT_MIN_CHANGED_RATIO * 10,
    );
  });

  it("agrees with the detector's own bucketing", () => {
    const spec = parseHeartbeatBandSpec(css);
    const summary = simulateHeartbeatLiveness(spec);
    const { videoMinFps, gameMinFps } = evaluateThroughDetector(spec);
    expect(summary.minFps).toBe(videoMinFps);
    expect(summary.gameMinFps).toBe(gameMinFps);
  });

  it("rejects the sweep that shipped before the fix", () => {
    // 2026-10-21 22:27 まで使っていた掃引: -12vh から 112vh。両端で帯が
    // 完全に画面外になり、その瞬間を含む 1 秒バケットが閾値を下回る
    // （issue #1001 / #1003 で観測された「映像が止まった」誤検知）。
    const legacy = parseHeartbeatBandSpec(legacyCss);
    const { videoMinFps } = evaluateThroughDetector(legacy);
    expect(isFpsAboveThreshold(videoMinFps, VIDEO_MIN_FPS)).toBe(false);
    // 帯だけが動いている前提でも、帯が画面外に出る間は絵が完全静止に
    // なる。1 秒バケットの最少フレーム数が 24 枚を下回ると「停止」。
    expect(videoMinFps).toBeLessThan(VIDEO_MIN_FPS);
  });

  it("mirrors the detector's pixel rules", () => {
    // `scripts/check-stream.ts` は owner 契約 #807 により改変できない。
    // 判定の定数を変えたら、この検証が気づけるようにしておく。
    expect(detectorSource).toMatch(
      new RegExp(`const MIN_CHANGED_RATIO = ${HEARTBEAT_MIN_CHANGED_RATIO}\\b`),
    );
    expect(detectorSource).toMatch(
      new RegExp(
        `const PIXEL_CHANNEL_TOLERANCE = ${HEARTBEAT_CHANNEL_TOLERANCE}\\b`,
      ),
    );
  });
});
