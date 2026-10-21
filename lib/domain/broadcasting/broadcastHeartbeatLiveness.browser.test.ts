import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium } from "playwright";
import {
  GAME_MIN_FPS,
  isFpsAboveThreshold,
  type MotionSample,
  summarizeFps,
  VIDEO_MIN_FPS,
} from "../../../scripts/check-stream";
import {
  HEARTBEAT_CHANNEL_TOLERANCE,
  HEARTBEAT_MIN_CHANGED_RATIO,
  type HeartbeatBandSpec,
  parseHeartbeatBandSpec,
  simulateHeartbeatLiveness,
} from "./broadcastHeartbeatLiveness";

/**
 * 実際に Chromium で描画した帯を、検知側と同じ縮小（128x72 へ
 * `drawImage`）で読み取って、検知側の判定に掛ける。
 *
 * 検知側 (`scripts/check-stream.ts`) は OBS の browser source が 1280x720 で
 * 配信している前提で、その絵を 128x72 へ縮小して比較する。この検証も
 * 同じ縮小と、同じ判定関数を使うので、帯が「実際に動いていること」を
 * 数値で確認できる。
 *
 * OBS の Color Key は取り込み後の処理なのでここでは再現できない。key を
 * 掛けた状態は `broadcastHeartbeatLiveness.test.ts` の純関数で確かめる。
 */

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../../../src/index.html"), "utf8");
const css = readFileSync(join(here, "../../../src/index.css"), "utf8");

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const SAMPLE_WIDTH = 128;
const SAMPLE_HEIGHT = 72;
const GAME_WIDTH_RATIO = 0.6;
const FPS = 30;
const BUCKET_MS = 1_000;
const WINDOW_MS = 2_000;
const FRAME_COUNT = 60;

const spec: HeartbeatBandSpec = parseHeartbeatBandSpec(css);

/**
 * 配信ページと同じ DOM と CSS だけのページを作る。`frontend.tsx` は
 * バンドル済みでないので読み込まない（帯は静的 HTML と CSS だけで動く
 * ことがこの検証の目的）。
 */
const buildPageHtml = (): string =>
  html
    .replace(/<link[^>]*>/g, "")
    .replace(/<script[^>]*><\/script>/g, "")
    .replace(/<\/head>/, `<style>\n${css}\n</style>\n</head>`);

/** ページ内で 1 フレームを縮小して、前フレームとの差分を求める。 */
const installSampler = async (
  page: import("playwright").Page,
): Promise<void> => {
  await page.evaluate(
    ({ sampleWidth, sampleHeight, tolerance }) => {
      const state = {
        previous: null as Uint8ClampedArray | null,
        canvas: document.createElement("canvas"),
      };
      state.canvas.width = sampleWidth;
      state.canvas.height = sampleHeight;
      const context = state.canvas.getContext("2d");
      (
        globalThis as unknown as { __heartbeatState: typeof state }
      ).__heartbeatState = state;
      (
        globalThis as unknown as { __heartbeatSample: unknown }
      ).__heartbeatSample = async (base64: string, gameWidth: number) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        if (!context) return null;
        context.clearRect(0, 0, sampleWidth, sampleHeight);
        context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
        const current = context.getImageData(
          0,
          0,
          sampleWidth,
          sampleHeight,
        ).data;
        const previous = state.previous;
        state.previous = current;
        if (!previous) return null;
        let changed = 0;
        let gameChanged = 0;
        for (let row = 0; row < sampleHeight; row += 1) {
          for (let col = 0; col < sampleWidth; col += 1) {
            const index = (row * sampleWidth + col) * 4;
            const differs =
              Math.abs((previous[index] ?? 0) - (current[index] ?? 0)) >
                tolerance ||
              Math.abs((previous[index + 1] ?? 0) - (current[index + 1] ?? 0)) >
                tolerance ||
              Math.abs((previous[index + 2] ?? 0) - (current[index + 2] ?? 0)) >
                tolerance;
            if (!differs) continue;
            changed += 1;
            if (col < gameWidth) gameChanged += 1;
          }
        }
        return {
          whole: changed / (sampleWidth * sampleHeight),
          game: gameChanged / (gameWidth * sampleHeight),
        };
      };
    },
    {
      sampleWidth: SAMPLE_WIDTH,
      sampleHeight: SAMPLE_HEIGHT,
      tolerance: HEARTBEAT_CHANNEL_TOLERANCE,
    },
  );
};

const sampleFrame = async (
  page: import("playwright").Page,
  base64: string,
): Promise<{ whole: number; game: number } | null> =>
  page.evaluate(
    async ([image, gameWidth]) =>
      (
        globalThis as unknown as {
          __heartbeatSample: (
            image: string,
            gameWidth: number,
          ) => Promise<{ whole: number; game: number } | null>;
        }
      ).__heartbeatSample(image as string, gameWidth as number),
    [base64, Math.floor(SAMPLE_WIDTH * GAME_WIDTH_RATIO)] as const,
  );

const launchBrowser = async (): Promise<Browser | undefined> => {
  try {
    return await chromium.launch();
  } catch {
    // Chromium が入っていない環境（単体テストの CI）ではスキップする。
    return undefined;
  }
};

const browser = await launchBrowser();

describe("broadcast heartbeat band in a real browser", () => {
  it.skipIf(!browser)(
    "keeps the delivered picture above the detector's thresholds",
    async () => {
      const page = await browser?.newPage({
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      });
      if (!page) return;
      await page.setContent(buildPageHtml());
      await page.waitForSelector("#broadcast-heartbeat");
      await installSampler(page);

      const samples: MotionSample[] = [];
      // 2 秒分（1 秒バケット 2 つ）を機械的にサンプルする。アニメーションを
      // 止めて各フレームの位置を明示的に指定するので、描画ごとのゆらぎが
      // 判定に混ざらない。
      for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
        const elapsedMs = (frame * 1000) / FPS;
        const phase = (elapsedMs % spec.durationMs) / spec.durationMs;
        const yVh = spec.fromVh + (spec.toVh - spec.fromVh) * phase;
        await page.evaluate((top) => {
          const band = document.getElementById("broadcast-heartbeat");
          if (!band) return;
          band.style.animation = "none";
          band.style.transform = `translateY(${top}vh)`;
        }, yVh);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              );
            }),
        );
        const screenshot = await page.screenshot({ type: "png" });
        const ratio = await sampleFrame(page, screenshot.toString("base64"));
        if (ratio) {
          samples.push({
            elapsedMs,
            wholeChanged: ratio.whole > HEARTBEAT_MIN_CHANGED_RATIO,
            gameChanged: ratio.game > HEARTBEAT_MIN_CHANGED_RATIO,
          });
        }
      }
      await page.close();

      const video = summarizeFps(
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
      expect(samples.length).toBe(FRAME_COUNT - 1);
      expect(isFpsAboveThreshold(video.minFps, VIDEO_MIN_FPS)).toBe(true);
      expect(isFpsAboveThreshold(game.minFps, GAME_MIN_FPS)).toBe(true);

      // 純関数（`simulateHeartbeatLiveness`）が実描画と 1 フレーム以内で
      // 一致する。純関数は「帯の仕様を CSS から読んで検知側の計算で
      // 評価する」ため、この一致があれば帯の仕様を実描画で確かめて
      // いないで更改を判断できる。
      const model = simulateHeartbeatLiveness(spec);
      expect(Math.abs(video.minFps - model.minFps)).toBeLessThanOrEqual(1);
      expect(Math.abs(game.minFps - model.gameMinFps)).toBeLessThanOrEqual(1);
    },
    120_000,
  );

  it.skipIf(!browser)(
    "keeps moving while the CSS animation runs on its own",
    async () => {
      const page = await browser?.newPage({
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      });
      if (!page) return;
      await page.setContent(buildPageHtml());
      await page.waitForSelector("#broadcast-heartbeat");
      await installSampler(page);

      let moved = 0;
      let compared = 0;
      for (let round = 0; round < 8; round += 1) {
        await page.waitForTimeout(80);
        const screenshot = await page.screenshot({ type: "png" });
        const ratio = await sampleFrame(page, screenshot.toString("base64"));
        if (!ratio) continue;
        compared += 1;
        if (ratio.whole > HEARTBEAT_MIN_CHANGED_RATIO) moved += 1;
      }
      await page.close();

      // アニメーションが自前で回っていれば、連続する描画のたびに絵が動く。
      expect(compared).toBeGreaterThan(0);
      expect(moved).toBe(compared);
    },
    60_000,
  );
});
