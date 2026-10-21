import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GAME_MIN_FPS, VIDEO_MIN_FPS } from "../../../scripts/check-stream";
import {
  DEFAULT_COLOR_KEY_THRESHOLD,
  type HeartbeatBandSpec,
  parseHeartbeatBandSpec,
  simulateHeartbeatLiveness,
} from "./broadcastHeartbeatLiveness";

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, "..", "..", "..", "src", "index.css");
const css = readFileSync(cssPath, "utf8");

/** OBS の Color Key（key = 黒）を模した鍵。 */
const blackKey = { threshold: DEFAULT_COLOR_KEY_THRESHOLD };

describe("broadcast heartbeat liveness", () => {
  it("keeps the delivered picture above the stream check threshold", () => {
    const spec = parseHeartbeatBandSpec(css);
    const summary = simulateHeartbeatLiveness(spec);

    expect(summary.minFps).toBeGreaterThan(VIDEO_MIN_FPS);
    expect(summary.gameMinFps).toBeGreaterThan(GAME_MIN_FPS);
  });

  it("keeps the delivered picture moving after OBS's color key", () => {
    const spec = parseHeartbeatBandSpec(css);
    const summary = simulateHeartbeatLiveness(spec, { colorKey: blackKey });

    expect(summary.minFps).toBeGreaterThan(VIDEO_MIN_FPS);
    expect(summary.gameMinFps).toBeGreaterThan(GAME_MIN_FPS);
  });

  it("never leaves the captured area", () => {
    const spec = parseHeartbeatBandSpec(css);

    // 帯の上端が -heightVh 未満か 100vh 超なら、帯が画面から消える瞬間が
    // できる。その瞬間は合成出力の 1 枚が完全に静止する。
    expect(spec.fromVh).toBeGreaterThanOrEqual(-spec.heightVh);
    expect(spec.toVh).toBeLessThanOrEqual(100);
  });

  it("would have failed the threshold while the band left the screen", () => {
    // 2026-10-22 01:28 の停止（issue #999）で配信されていた帯の動かし方。
    // 帯が画面から消える 0.35 秒のあいだは合成出力の 1 枚が完全に静止し、
    // 1 秒バケットの移動フレーム数が 24 枚を下回る。検知側と同じ判定を
    // そのまま使うので、この定義のまま「停止」と誤検知される。
    const previous: HeartbeatBandSpec = {
      fromVh: -12,
      toVh: 112,
      heightVh: 6,
      durationMs: 2400,
      stops: [
        { offset: 0, color: { r: 16 / 255, g: 185 / 255, b: 129 / 255, a: 0 } },
        {
          offset: 0.38,
          color: { r: 16 / 255, g: 185 / 255, b: 129 / 255, a: 0.55 },
        },
        { offset: 0.5, color: { r: 1, g: 1, b: 1, a: 0.6 } },
        {
          offset: 0.62,
          color: { r: 16 / 255, g: 185 / 255, b: 129 / 255, a: 0.55 },
        },
        { offset: 1, color: { r: 16 / 255, g: 185 / 255, b: 129 / 255, a: 0 } },
      ],
    };
    const summary = simulateHeartbeatLiveness(previous);

    expect(summary.minFps).toBeLessThanOrEqual(VIDEO_MIN_FPS);
  });

  it("uses the same thresholds as the stream check", () => {
    const spec = parseHeartbeatBandSpec(css);
    const summary = simulateHeartbeatLiveness(spec);

    // 検知側と同じ数え方であることを確かめるため、閾値ではなく実測値で
    // 判定する（1 秒バケットの最少移動フレーム数が 24 を超えること）。
    expect(summary.minFps).toBeGreaterThan(VIDEO_MIN_FPS);
    expect(summary.avgFps).toBeGreaterThan(VIDEO_MIN_FPS);
  });
});
