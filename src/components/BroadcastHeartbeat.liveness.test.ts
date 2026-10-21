import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAME_CLIP,
  isFpsAboveThreshold,
  type MotionSample,
  summarizeFps,
  VIDEO_MIN_FPS,
} from "../../scripts/check-stream";

/**
 * 鼓動の帯が「外からの異常検知」を満たすことを、検知側と同じ計算で確かめる。
 *
 * 検知 (`scripts/check-stream.ts`) は配信された映像を 128x72 に縮めて 1 フレーム
 * ごとの差分を見、10 秒窓を 1 秒バケットに切って **全バケット** で 24 枚超の
 * 移動フレームを要求する（`VIDEO_MIN_FPS`）。帯が画面の外へ完全に出ている
 * 瞬間は映像が完全に静止し、そのバケットは 24 枚を下回って「映像全体が
 * 停止し続けています」と誤検知される（issue #982）。
 *
 * ここでは帯の CSS（位置・高さ・周期・配色）を読み取って、配信された絵を
 * 128x72 へ縮めた標本を作り、検知と**同じ**判定関数
 * (`summarizeFps` / `isFpsAboveThreshold`) で判定する。CSS を変えたらこの
 * テストが落ちる。
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "index.css"), "utf8");

/** 検知側の縮小・しきい値（`scripts/check-stream.ts` と同じ値）。 */
const MAX_SAMPLE_DIMENSION = 128;
const PIXEL_CHANNEL_TOLERANCE = 16;
const MIN_CHANGED_RATIO = 0.001;
/** OBS の出力 fps（`obs-studio/basic/profiles/Makamujo/basic.ini` の FPSNum）。 */
const DELIVERED_FPS = 30;
/** 検知側の窓（`CHECK_DURATION_MS`）。 */
const WINDOW_MS = 10_000;
/** 検知側のバケット幅（`FPS_BUCKET_MS`）。 */
const BUCKET_MS = 1_000;

type Rgba = { r: number; g: number; b: number; a: number };

type GradientStop = { at: number; color: Rgba };

type BandGeometry = {
  /** 帯の上端の移動範囲 (vh)。 */
  fromVh: number;
  toVh: number;
  /** 帯の高さ (vh)。 */
  heightVh: number;
  /** 1 往復にかかる時間 (秒)。 */
  durationSeconds: number;
  /** 帯の縦の配色。 */
  stops: GradientStop[];
};

const requireGroup = (
  pattern: RegExp,
  source: string,
  label: string,
  group = 1,
): string => {
  const matched = pattern.exec(source);
  const value = matched?.[group];
  if (value === undefined) {
    throw new Error(
      `the heartbeat band CSS no longer matches ${label}; update this test (${pattern})`,
    );
  }
  return value;
};

const parseColor = (raw: string): Rgba => {
  const parts = raw.split(",").map((part) => Number.parseFloat(part.trim()));
  const [r, g, b, a] = parts;
  if (r === undefined || g === undefined || b === undefined) {
    throw new Error(`the heartbeat band CSS has an unreadable color: ${raw}`);
  }
  return { r, g, b, a: a ?? 1 };
};

const readBandGeometry = (): BandGeometry => {
  const keyframes = requireGroup(
    /@keyframes\s+broadcast-heartbeat-sweep\s*\{([\s\S]*?)\n\}/,
    css,
    "the sweep keyframes",
  );
  const rule = requireGroup(
    /\.broadcast-heartbeat\s*\{([\s\S]*?)\n\}/,
    css,
    "the band rule",
  );
  const fromVh = Number.parseFloat(
    requireGroup(
      /from\s*\{[^}]*translateY\((-?[\d.]+)vh\)/,
      keyframes,
      "the start position",
    ),
  );
  const toVh = Number.parseFloat(
    requireGroup(
      /to\s*\{[^}]*translateY\((-?[\d.]+)vh\)/,
      keyframes,
      "the end position",
    ),
  );
  const heightVh = Number.parseFloat(
    requireGroup(/height:\s*([\d.]+)vh/, rule, "the band height"),
  );
  const durationSeconds = Number.parseFloat(
    requireGroup(
      /animation:\s*broadcast-heartbeat-sweep\s+([\d.]+)s/,
      rule,
      "the animation period",
    ),
  );
  const gradient = requireGroup(
    /linear-gradient\(\s*to bottom,\s*([\s\S]*?)\);/,
    rule,
    "the band gradient",
  );
  const stops = [...gradient.matchAll(/rgba?\(([^)]+)\)\s+([\d.]+)%/g)].map(
    (matched) => ({
      at: Number.parseFloat(matched[2] ?? "0") / 100,
      color: parseColor(matched[1] ?? ""),
    }),
  );
  if (stops.length < 2) {
    throw new Error("the heartbeat band CSS has no readable gradient stops");
  }
  return { fromVh, toVh, heightVh, durationSeconds, stops };
};

const colorAt = (stops: GradientStop[], ratio: number): Rgba => {
  const clamped = Math.min(1, Math.max(0, ratio));
  for (let index = 0; index < stops.length - 1; index += 1) {
    const current = stops[index];
    const next = stops[index + 1];
    if (!current || !next) continue;
    if (clamped < current.at || clamped > next.at) continue;
    const span = next.at - current.at;
    const t = span === 0 ? 0 : (clamped - current.at) / span;
    return {
      r: current.color.r + (next.color.r - current.color.r) * t,
      g: current.color.g + (next.color.g - current.color.g) * t,
      b: current.color.b + (next.color.b - current.color.b) * t,
      a: current.color.a + (next.color.a - current.color.a) * t,
    };
  }
  const last = stops[stops.length - 1];
  if (!last) {
    throw new Error("the heartbeat band CSS has no gradient stops");
  }
  return last.color;
};

/**
 * 配信された 1 フレームを、検知側の標本（128x72）として作る。
 *
 * 帯は `position: fixed` で画面の上から `translateY` だけ動かした全幅の矩形。
 * 標本は 72px = 100vh なので 1vh は 0.72px。
 */
const renderSample = (
  band: BandGeometry,
  bandTopVh: number,
  background: { r: number; g: number; b: number },
): Uint8ClampedArray => {
  const width = MAX_SAMPLE_DIMENSION;
  const height = Math.round((MAX_SAMPLE_DIMENSION * 9) / 16);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const bandTopPx = bandTopVh * (height / 100);
  const bandHeightPx = band.heightVh * (height / 100);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      let { r, g, b } = background;
      if (y + 0.5 >= bandTopPx && y + 0.5 < bandTopPx + bandHeightPx) {
        const overlay = colorAt(
          band.stops,
          (y + 0.5 - bandTopPx) / bandHeightPx,
        );
        r = overlay.r * overlay.a + r * (1 - overlay.a);
        g = overlay.g * overlay.a + g * (1 - overlay.a);
        b = overlay.b * overlay.a + b * (1 - overlay.a);
      }
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
};

/** 検知側と同じ差分判定。差分率とゲーム部分の差分率を返す。 */
const changedRatios = (
  previous: Uint8ClampedArray,
  current: Uint8ClampedArray,
  width: number,
  height: number,
): { whole: number; game: number } => {
  const gameWidth = Math.max(1, Math.floor(width * GAME_CLIP.widthRatio));
  let wholeChanged = 0;
  let gameChanged = 0;
  let wholeTotal = 0;
  let gameTotal = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const redDiff = Math.abs(
        (previous[offset] ?? 0) - (current[offset] ?? 0),
      );
      const greenDiff = Math.abs(
        (previous[offset + 1] ?? 0) - (current[offset + 1] ?? 0),
      );
      const blueDiff = Math.abs(
        (previous[offset + 2] ?? 0) - (current[offset + 2] ?? 0),
      );
      const moved =
        redDiff > PIXEL_CHANNEL_TOLERANCE ||
        greenDiff > PIXEL_CHANNEL_TOLERANCE ||
        blueDiff > PIXEL_CHANNEL_TOLERANCE;
      wholeTotal += 1;
      if (x < gameWidth) gameTotal += 1;
      if (moved) {
        wholeChanged += 1;
        if (x < gameWidth) gameChanged += 1;
      }
    }
  }
  return {
    whole: wholeTotal === 0 ? 0 : wholeChanged / wholeTotal,
    game: gameTotal === 0 ? 0 : gameChanged / gameTotal,
  };
};

/**
 * 帯だけを合成した配信映像を、検知側と同じ手順でサンプルする。
 *
 * 映像は 30fps（OBS の出力 fps）で、検知側は requestAnimationFrame ごとに
 * 標本を比較する。1 フレームにつき 1 回だけ「変化した」サンプルが立つ。
 */
const sampleDeliveredPicture = (
  band: BandGeometry,
  background: { r: number; g: number; b: number },
): { samples: MotionSample[]; minRatio: number } => {
  const width = MAX_SAMPLE_DIMENSION;
  const height = Math.round((MAX_SAMPLE_DIMENSION * 9) / 16);
  const frameMs = 1000 / DELIVERED_FPS;
  const frames = Math.round(WINDOW_MS / frameMs);
  const samples: MotionSample[] = [];
  let previous: Uint8ClampedArray | null = null;
  let minRatio = 1;
  for (let frame = 0; frame < frames; frame += 1) {
    const elapsedMs = frame * frameMs;
    const cycle = (elapsedMs / 1000 / band.durationSeconds) % 1;
    const bandTopVh = band.fromVh + (band.toVh - band.fromVh) * cycle;
    const current = renderSample(band, bandTopVh, background);
    if (previous) {
      const ratios = changedRatios(previous, current, width, height);
      minRatio = Math.min(minRatio, ratios.whole, ratios.game);
      samples.push({
        elapsedMs,
        wholeChanged: ratios.whole > MIN_CHANGED_RATIO,
        gameChanged: ratios.game > MIN_CHANGED_RATIO,
      });
    }
    previous = current;
  }
  return { samples, minRatio };
};

describe("the heartbeat band keeps the delivered picture moving", () => {
  const band = readBandGeometry();

  it("keeps a part of the band on screen at every moment", () => {
    // 帯が完全に画面外へ出ている瞬間は映像が完全静止し、1 秒バケットの移動
    // フレーム数が 24 枚を下回って「停止」と誤検知される。
    const visibleVh = (bandTopVh: number) =>
      Math.min(bandTopVh + band.heightVh, 100) - Math.max(bandTopVh, 0);
    const steps = 240;
    for (let step = 0; step <= steps; step += 1) {
      const cycle = step / steps;
      const bandTopVh = band.fromVh + (band.toVh - band.fromVh) * cycle;
      expect(visibleVh(bandTopVh)).toBeGreaterThan(0);
    }
  });

  it("passes the health check's frame rate requirement", () => {
    for (const background of [
      { name: "a dark game screen", r: 16, g: 20, b: 28 },
      { name: "a bright game screen", r: 240, g: 240, b: 240 },
    ]) {
      const { samples, minRatio } = sampleDeliveredPicture(band, background);
      const whole = summarizeFps(
        samples,
        (sample) => sample.wholeChanged,
        BUCKET_MS,
        WINDOW_MS,
      );
      const game = summarizeFps(
        samples,
        (sample) => sample.gameChanged,
        BUCKET_MS,
        WINDOW_MS,
      );
      expect(
        isFpsAboveThreshold(whole.minFps, VIDEO_MIN_FPS),
        `the whole picture must keep ${VIDEO_MIN_FPS} fps against ${background.name}`,
      ).toBe(true);
      expect(
        isFpsAboveThreshold(game.minFps, VIDEO_MIN_FPS),
        `the game panel must keep ${VIDEO_MIN_FPS} fps against ${background.name}`,
      ).toBe(true);
      // 差分率がしきい値を下回ると「動いていない」フレームとして数えられる。
      expect(minRatio).toBeGreaterThan(MIN_CHANGED_RATIO);
    }
  });
});
