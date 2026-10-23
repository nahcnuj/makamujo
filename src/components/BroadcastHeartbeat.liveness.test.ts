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
 * ごとの差分を見、10 秒窓を 1 秒バケットに切って **全バケット** で 24 枚以上の
 * 移動フレームを要求する（`VIDEO_MIN_FPS`）。帯が画面の外へ完全に出ている
 * 瞬間は映像が完全に静止し、そのバケットは 24 枚を下回って「映像全体が
 * 停止し続けています」と誤検知される（issue #982）。
 *
 * ここでは帯の CSS（位置・幅・高さ・周期・配色）を読み取って、配信された絵を
 * 128x72 へ縮めた標本を作り、検知と**同じ**判定関数
 * (`summarizeFps` / `isFpsAboveThreshold`) で判定する。CSS を変えたらこの
 * テストが落ちる。
 *
 * 帯は全幅ではなく、左端の細い縦帯である（issue #1030: 全幅の帯が配信映像に
 * CRT の走査線のように見え続けた）。検知が見るのは左 60% のゲーム部分なので、
 * 左端の帯でも毎フレーム動いていれば足りる。ゲームの絵を隠す面積は
 * 2vw x 12vh = 画面の 0.24% に留める。0.5vw の最小構成は差分画素が
 * しきい値ぎりぎりで、実測 min fps 23 / 0 fps まで落ちたため（issue #1112 /
 * 2026-10-24 01:15）、差分に余裕を持たせた幅にしている。
 *
 * 標本を作る時は、配信映像が立つまでの経路をなぞる。
 *
 * 1. ページ。`:root` の `bg-black` が canvas に伝播するので、帯の外は
 *    不透明な黒に Layout の `bg-emerald-950/30` が重なった暗い背景になる。
 * 2. OBS の Color Key（key = 黒）。この暗い背景は消えて、游戏画面が透ける。
 *    key 色の許容範囲は環境と設定で変わるので、帯は key 色から十分離れた
 *    画素を**不透明に**残しておかないと「帯が残っている」保証が立たない。
 * 3. ゲーム画面（XSHM のキャプチャ）を背後に合成した絵が、公開される絵。
 * 4. 検知側は requestAnimationFrame（≒60Hz）ごとに標本を比較する。公開
 *    映像は 30fps なので、同じフレームを 2 回ずつ拾う。観測できる変化
 *    フレームは 1 秒あたり 30 枚が上限で、公開フレームが 1 枚でも重な
 *    ればそのバケットは 29 枚になる。
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "index.css"), "utf8");

/** 検知側の縮小・しきい値（`scripts/check-stream.ts` と同じ値）。 */
const MAX_SAMPLE_DIMENSION = 128;
const PIXEL_CHANNEL_TOLERANCE = 16;
const MIN_CHANGED_RATIO = 0.001;
/** OBS の出力 fps（`obs-studio/basic/profiles/Makamujo/basic.ini` の FPSNum）。 */
const DELIVERED_FPS = 30;
/** 検知側のサンプリング間隔（requestAnimationFrame ≒ 60Hz）。 */
const SAMPLER_FPS = 60;
/** 検知側の窓（`CHECK_DURATION_MS`）。 */
const WINDOW_MS = 10_000;
/** 検知側のバケット幅（`FPS_BUCKET_MS`）。 */
const BUCKET_MS = 1_000;
/**
 * Color Key（key = 黒）が残す画素の下限。
 *
 * key 色に近い画素は消える。similarity / smoothness の設定と配信環境によって
 * 消される範囲は変わるので、帯は key 色から**十分離れた**画素を不透明に
 * 確保する。帯の半透明な部分は暗い背景と混ざって key 色寄りになり、
 * 消されたときは白背景の上でも黒背景の上でも見えなくなる。
 */
const KEY_BRIGHTNESS_FLOOR = 160;
/**
 * 帯のうち「Color Key に消されず、どのゲーム画面でも見える」領域が
 * 少なくとも持つべき割合。
 *
 * 白だけの帯は白背景の上で消える。緑は黒背景でも白背景でもゲーム画面と
 * 十分に差が出るが、半透明だと暗いページ背景と混ざって key 色寄りに
 * なり得る。帯を不透明な緑一色にするのがこの条件の中身。
 */
const MIN_DETECTABLE_BAND_RATIO = 0.08;
/**
 * 帯の幅 (vw) の上限。
 *
 * 全幅の帯は配信映像に CRT の走査線のように見え続けた（issue #1030）。
 * 検知に必要な動きは左端の細い帯でも足りるので、ゲームの絵を覆う面積を
 * 最小限にする。
 */
const MAX_BAND_WIDTH_VW = 2;

type Rgba = { r: number; g: number; b: number; a: number };

type GradientStop = { at: number; color: Rgba };

type BandGeometry = {
  /** 帯の上端の移動範囲 (vh)。 */
  fromVh: number;
  toVh: number;
  /** 帯の左端 (vw)。 */
  leftVw: number;
  /** 帯の幅 (vw)。 */
  widthVw: number;
  /** 帯の高さ (vh)。 */
  heightVh: number;
  /** 1 往復にかかる時間 (秒)。 */
  durationSeconds: number;
  /** 帯の縦の配色。 */
  stops: GradientStop[];
};

/** 帯の外のページ。canvas は `:root` の `bg-black` に伝播した不透明白。 */
const PAGE_CANVAS: Rgba = { r: 0, g: 0, b: 0, a: 1 };
/** Layout の `bg-emerald-950/30`（tailwind の emerald-950）。 */
const PAGE_BACKGROUND: Rgba = { r: 6, g: 78, b: 59, a: 0.3 };

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
  const leftVw = Number.parseFloat(
    requireGroup(/left:\s*(-?[\d.]+)vw/, rule, "the band left"),
  );
  const widthVw = Number.parseFloat(
    requireGroup(/width:\s*([\d.]+)vw/, rule, "the band width"),
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
  return {
    fromVh,
    toVh,
    leftVw,
    widthVw,
    heightVh,
    durationSeconds,
    stops,
  };
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

/** 色を premultiplied alpha にする。 */
const premultiply = (color: Rgba): Rgba => ({
  r: color.r * color.a,
  g: color.g * color.a,
  b: color.b * color.a,
  a: color.a,
});

/** premultiplied の合成（上を下へ）。 */
const over = (top: Rgba, bottom: Rgba): Rgba => ({
  r: top.r + bottom.r * (1 - top.a),
  g: top.g + bottom.g * (1 - top.a),
  b: top.b + bottom.b * (1 - top.a),
  a: top.a + bottom.a * (1 - top.a),
});

/**
 * 配信された 1 フレームを、検知側の標本（128x72）として作る。
 *
 * 帯は `position: fixed` で画面の上から `translateY` だけ動かした矩形。
 * 標本は 72px = 100vh なので 1vh は 0.72px、128px = 100vw なので
 * 1vw は 1.28px。左端の細い帯も、この縮小で 1〜2 列の差分として残る。
 *
 * ページ → Color Key → ゲーム画面、の順に合成する。
 */
const renderSample = (
  band: BandGeometry,
  bandTopVh: number,
  game: Rgba,
): Uint8ClampedArray => {
  const width = MAX_SAMPLE_DIMENSION;
  const height = Math.round((MAX_SAMPLE_DIMENSION * 9) / 16);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const bandTopPx = bandTopVh * (height / 100);
  const bandHeightPx = band.heightVh * (height / 100);
  const bandLeftPx = band.leftVw * (width / 100);
  const bandWidthPx = band.widthVw * (width / 100);
  const page = over(premultiply(PAGE_BACKGROUND), premultiply(PAGE_CANVAS));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      let pagePixel = page;
      if (
        y + 0.5 >= bandTopPx &&
        y + 0.5 < bandTopPx + bandHeightPx &&
        x + 0.5 >= bandLeftPx &&
        x + 0.5 < bandLeftPx + bandWidthPx
      ) {
        const overlay = colorAt(
          band.stops,
          (y + 0.5 - bandTopPx) / bandHeightPx,
        );
        pagePixel = over(premultiply(overlay), page);
      }
      // OBS の Color Key（key = 黒）。key 色から遠い画素だけが残る。
      const keyed =
        Math.max(pagePixel.r, pagePixel.g, pagePixel.b) >= KEY_BRIGHTNESS_FLOOR
          ? pagePixel
          : { r: 0, g: 0, b: 0, a: 0 };
      // ゲーム画面（XSHM のキャプチャ）を背後に合成する。
      const published = over(keyed, premultiply(game));
      pixels[offset] = published.r;
      pixels[offset + 1] = published.g;
      pixels[offset + 2] = published.b;
      pixels[offset + 3] = published.a * 255;
    }
  }
  return pixels;
};

/**
 * 「Color Key に消されず、どのゲーム画面でも見える」帯の割合を測る。
 *
 * その条件を満たすのは、
 * - 不透明（半透明だと暗いページ背景と混ざって key 色寄りになる）
 * - key 色（黒）から十分離れている
 * - 黒背景にも白背景にも、検知側の差分しきい値を超える差になる
 * 画素帯。帯は不透明な緑一色なので、その区間の合計を測る。
 */
const detectableBandRatio = (band: BandGeometry): number => {
  const visibleOn = (color: Rgba, background: Rgba): boolean => {
    const diff = Math.max(
      Math.abs(color.r - background.r),
      Math.abs(color.g - background.g),
      Math.abs(color.b - background.b),
    );
    return diff > PIXEL_CHANNEL_TOLERANCE;
  };
  const isDetectable = (color: Rgba): boolean => {
    if (color.a < 1) return false;
    if (Math.max(color.r, color.g, color.b) < KEY_BRIGHTNESS_FLOOR)
      return false;
    return (
      visibleOn(color, { r: 0, g: 0, b: 0, a: 1 }) &&
      visibleOn(color, { r: 240, g: 240, b: 240, a: 1 })
    );
  };
  let ratio = 0;
  for (let index = 0; index < band.stops.length - 1; index += 1) {
    const current = band.stops[index];
    const next = band.stops[index + 1];
    if (!current || !next) continue;
    if (!isDetectable(current.color) || !isDetectable(next.color)) continue;
    ratio += next.at - current.at;
  }
  return ratio;
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
 * 公開映像は 30fps（OBS の出力 fps）で、検知側は requestAnimationFrame
 * （≒60Hz）ごとに標本を比較する。公開フレームが変わるまでは同じ絵が
 * 見えているので、変化として数えられるのは公開フレームが変わる時だけ。
 */
const sampleDeliveredPicture = (
  band: BandGeometry,
  game: Rgba,
): { samples: MotionSample[]; minPublishedRatio: number } => {
  const width = MAX_SAMPLE_DIMENSION;
  const height = Math.round((MAX_SAMPLE_DIMENSION * 9) / 16);
  const samplerStepMs = 1000 / SAMPLER_FPS;
  const publishedStepMs = 1000 / DELIVERED_FPS;
  const sampleCount = Math.round(WINDOW_MS / samplerStepMs);
  const samples: MotionSample[] = [];
  let previousSample: Uint8ClampedArray | null = null;
  let previousPublished: Uint8ClampedArray | null = null;
  let publishedIndex = -1;
  let minPublishedRatio = 1;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const elapsedMs = sample * samplerStepMs;
    const index = Math.floor(elapsedMs / publishedStepMs);
    // 公開フレームは 30fps ごとに切り替わるので、絵はその時刻で固定される。
    const publishedMs = index * publishedStepMs;
    const cycle = (publishedMs / 1000 / band.durationSeconds) % 1;
    const bandTopVh = band.fromVh + (band.toVh - band.fromVh) * cycle;
    const current = renderSample(band, bandTopVh, game);
    if (index !== publishedIndex) {
      if (previousPublished) {
        const ratios = changedRatios(previousPublished, current, width, height);
        minPublishedRatio = Math.min(
          minPublishedRatio,
          ratios.whole,
          ratios.game,
        );
      }
      previousPublished = current;
      publishedIndex = index;
    }
    if (previousSample) {
      const ratios = changedRatios(previousSample, current, width, height);
      samples.push({
        elapsedMs,
        wholeChanged: ratios.whole > MIN_CHANGED_RATIO,
        gameChanged: ratios.game > MIN_CHANGED_RATIO,
      });
    }
    previousSample = current;
  }
  return { samples, minPublishedRatio };
};

describe("the heartbeat band keeps the delivered picture moving", () => {
  const band = readBandGeometry();
  const backgrounds = [
    { name: "a dark game screen", color: { r: 16, g: 20, b: 28, a: 1 } },
    { name: "a bright game screen", color: { r: 240, g: 240, b: 240, a: 1 } },
  ];

  it("stays a narrow edge strip instead of a full-width scanline", () => {
    // issue #1030: 全幅の帯は走査線として見え続けた。左端の細い帯に留め、
    // ゲーム部分（左 60%）の中でも大部分の絵を隠さない。
    expect(band.widthVw).toBeLessThanOrEqual(MAX_BAND_WIDTH_VW);
    expect(band.leftVw).toBeGreaterThanOrEqual(0);
    expect(band.leftVw + band.widthVw).toBeLessThanOrEqual(
      GAME_CLIP.widthRatio * 100,
    );
    const areaRatio = (band.widthVw / 100) * (band.heightVh / 100);
    expect(areaRatio).toBeLessThan(0.01);
  });

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

  it("keeps a region that survives the color key on any game screen", () => {
    // OBS の Color Key（key = 黒）は key 色から遠い画素しか残さない。帯が
    // 白だけだと白背景の上で消えてしまい、帯が半透明だと暗いページ背景と
    // 混ざって key 色寄りになる。不透明な緑一色にする。
    expect(detectableBandRatio(band)).toBeGreaterThanOrEqual(
      MIN_DETECTABLE_BAND_RATIO,
    );
  });

  it("keeps every published frame different", () => {
    // 公開フレームが 1 枚でも重なると、その 1 秒バケットは 29 枚になる。
    // 帯は Color Key で消された後でも、公開フレームごとに絵が変わる。
    for (const background of backgrounds) {
      const { minPublishedRatio } = sampleDeliveredPicture(
        band,
        background.color,
      );
      expect(
        minPublishedRatio,
        `the published frames must differ against ${background.name}`,
      ).toBeGreaterThan(MIN_CHANGED_RATIO);
    }
  });

  it("keeps a safety margin over the pixel-difference threshold", () => {
    // 幅 0.5vw の最小構成は差分画素がしきい値をわずかに上回るだけで、
    // エンコーダや縮小のばらつきで 1 秒バケットが 24 枚を割った
    // （issue #1112: min 23 / 0 fps）。差分がしきい値の 2 倍を保つことを
    // 要求し、これ以上の細幅化・低速化を弾く。
    const requiredRatio = MIN_CHANGED_RATIO * 2;
    for (const background of backgrounds) {
      const { minPublishedRatio } = sampleDeliveredPicture(
        band,
        background.color,
      );
      expect(
        minPublishedRatio,
        `the moved pixels must exceed ${requiredRatio} against ${background.name}`,
      ).toBeGreaterThan(requiredRatio);
    }
  });

  it("passes the health check's frame rate requirement", () => {
    for (const background of backgrounds) {
      const { samples } = sampleDeliveredPicture(band, background.color);
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
    }
  });
});
