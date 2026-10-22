import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GAME_CLIP,
  GAME_MIN_FPS,
  isFpsAboveThreshold,
  type MotionSample,
  summarizeFps,
  VIDEO_MIN_FPS,
} from "../../scripts/check-stream";

/**
 * 出荷する鼓動（帯）が、外からの配信異常検知に「動いている」と判定される
 * ことを確かめる統合テスト。
 *
 * 検知は `scripts/check-stream.ts`（owner 契約 #807。改変しない）が外から
 * 読む: 10 秒窓を 1 秒バケットに切り、128x72 に縮めた絵を 1 サンプル行ずつ
 * 比べ、1 バケットに 24 枚以上（ゲーム部分は左 60% で 8 枚以上）変化した
 * フレームを要求する。ゲームが結果画面やフリートークで止まっている間は、
 * オーバーレイの帯だけが動くので、帯が契約を満たさないと合成出力は
 * 本当に全フレーム同一になり、停止として報告される（2026-10-22 12:30:56
 * JST: `videoMinFps = 0` / `gameMinFps = 0`、音声と media clock は進んで
 * いた）。
 *
 * ここでは実際の出荷物（`src/index.css` の CSS と `src/index.html` の
 * マークアップ）をそのまま描画し、検知と同じ手順で絵を比べて、検知自身の
 * 判定関数としきい値で採点する。帯が無くても「止まった絵」になることも
 * 対照として確かめる。
 *
 * Chromium が起動できない環境では skip する。
 */

/** 検知が縮める絵の横幅（`scripts/check-stream.ts` と同じ値）。 */
const SAMPLE_MAX_DIMENSION = 128;
/** 1 サンプル行觉得这の差があれば「変化」と数える（検知と同じ値）。 */
const PIXEL_CHANNEL_TOLERANCE = 16;
/** 変化と数えるピクセルの割合の下限（検知と同じ値）。 */
const MIN_CHANGED_RATIO = 0.001;
/** OBS のブラウザソースが配信するフレームレート。 */
const DELIVERY_FPS = 30;
/** 測定窓。検知と同じ 1 秒バケットで 3 バケット分取る。 */
const WINDOW_MS = 3_000;
/** 1 バケットの長さ（検知と同じ値）。 */
const BUCKET_MS = 1_000;

declare global {
  interface Window {
    /**
     * 直前のフレームと今のフレームを比べ、検知と同じしきい値で
     * 「全体が変わったか」「ゲーム部分（左 60%）が変わったか」を返す。
     */
    __mmjCompareFrame?: (
      dataUrl: string,
    ) => Promise<{ whole: boolean; game: boolean } | null>;
  }
}

/** 静止したゲーム画面を模した背景（止まった絵の上に帯だけ動く）。 */
const BACKGROUNDS = [
  "linear-gradient(140deg, #0b1220 0%, #1f2937 55%, #064e3b 100%)",
  "linear-gradient(140deg, #f5f5f0 0%, #d1d5db 55%, #a7f3d0 100%)",
];

const repoFile = (path: string): string =>
  readFileSync(join(process.cwd(), path), "utf8");

/** 出荷するページをそのまま使う（帯の要素と静的なスタイルを含む）。 */
const shippedPage = repoFile("src/index.html");
const shippedBand =
  shippedPage.match(/<div class="broadcast-heartbeat"[^>]*><\/div>/)?.[0] ?? "";

/**
 * 外部の資産（CSS ファイルとバンドル）だけを外した出荷ページ。
 *
 * 帯は HTML の中の静的な要素と静的なスタイルで完結しているので、それだけ
 * 残れば帯は動く。ゲーム画面は止まっている絵として静止した背景を差し込む。
 */
const renderablePage = (background: string, withBand: boolean): string =>
  shippedPage
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
    .replace(/<script[^>]*src="\.\/frontend\.tsx"[^>]*><\/script>/g, "")
    .replace(
      /<body>/,
      `<body style="margin:0;overflow:hidden;background:${background}">`,
    )
    .replace(
      '<div class="broadcast-heartbeat" aria-hidden="true"></div>',
      withBand ? shippedBand : "",
    );

const chromiumAvailable = await (async (): Promise<boolean> => {
  try {
    const { chromium } = await import("playwright");
    const probe = await chromium.launch({
      headless: true,
      timeout: 60_000,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    await probe.close();
    return true;
  } catch (error) {
    console.warn(
      "[TEST DIAG] chromium unavailable; the heartbeat detection integration test will be skipped:",
      error instanceof Error ? error.message.split("\n")[0] : String(error),
    );
    return false;
  }
})();

interface FrameSummary {
  wholeMinFps: number;
  wholeAvgFps: number;
  gameMinFps: number;
  gameAvgFps: number;
}

/**
 * 1 ページを描画して 1 窓ぶん測る。
 *
 * 比較はページの中の canvas で行う（検知も同じ手順で縮めた絵を 1 サンプル行
 * ずつ比べる）。帯のアニメーションは一時停止して時刻をコマ送りし、OBS が
 * 30fps で配信するときの絵を再現する。
 */
const measure = async (
  background: string,
  withBand: boolean,
): Promise<FrameSummary> => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.setContent(renderablePage(background, withBand));
    await page.waitForTimeout(300);

    await page.evaluate(
      (config) => {
        const canvas = document.createElement("canvas");
        canvas.width = config.sampleWidth;
        canvas.height = config.sampleRows;
        const context = canvas.getContext("2d", {
          willReadFrequently: true,
        });
        let previous: Uint8ClampedArray | null = null;
        window.__mmjCompareFrame = async (dataUrl: string) => {
          const image = new Image();
          image.src = dataUrl;
          await image.decode();
          if (!context) return null;
          context.clearRect(0, 0, config.sampleWidth, config.sampleRows);
          context.drawImage(image, 0, 0, config.sampleWidth, config.sampleRows);
          const current = context.getImageData(
            0,
            0,
            config.sampleWidth,
            config.sampleRows,
          ).data;
          const before = previous;
          previous = current;
          if (!before) return null;
          let whole = 0;
          let game = 0;
          const gameWidth = Math.floor(
            config.sampleWidth * config.gameWidthRatio,
          );
          const total = config.sampleWidth * config.sampleRows;
          for (let pixel = 0; pixel < total; pixel += 1) {
            const index = pixel * 4;
            const red = Math.abs((before[index] ?? 0) - (current[index] ?? 0));
            const green = Math.abs(
              (before[index + 1] ?? 0) - (current[index + 1] ?? 0),
            );
            const blue = Math.abs(
              (before[index + 2] ?? 0) - (current[index + 2] ?? 0),
            );
            if (
              red > config.channelTolerance ||
              green > config.channelTolerance ||
              blue > config.channelTolerance
            ) {
              whole += 1;
              if (pixel % config.sampleWidth < gameWidth) game += 1;
            }
          }
          return {
            whole: whole / total > config.minChangedRatio,
            game:
              game / (gameWidth * config.sampleRows) > config.minChangedRatio,
          };
        };
      },
      {
        sampleWidth: SAMPLE_MAX_DIMENSION,
        sampleRows: Math.round((720 * SAMPLE_MAX_DIMENSION) / 1280),
        channelTolerance: PIXEL_CHANNEL_TOLERANCE,
        minChangedRatio: MIN_CHANGED_RATIO,
        gameWidthRatio: GAME_CLIP.widthRatio,
      },
    );

    const samples: MotionSample[] = [];
    const totalFrames = Math.floor((WINDOW_MS / 1000) * DELIVERY_FPS);
    for (let tick = 0; tick < totalFrames; tick += 1) {
      const elapsedMs = tick * (1000 / DELIVERY_FPS);
      await page.evaluate(async (timeMs: number) => {
        const band = document.querySelector(".broadcast-heartbeat");
        const animation =
          band instanceof HTMLElement
            ? (band.getAnimations()[0] ?? null)
            : null;
        animation?.pause();
        if (animation) animation.currentTime = timeMs;
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      }, elapsedMs);
      const screenshot = await page.screenshot({ type: "png" });
      const compared = await page.evaluate(
        (dataUrl: string) => window.__mmjCompareFrame?.(dataUrl) ?? null,
        `data:image/png;base64,${screenshot.toString("base64")}`,
      );
      if (!compared) continue;
      samples.push({
        elapsedMs,
        wholeChanged: compared.whole,
        gameChanged: compared.game,
      });
    }

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
    return {
      wholeMinFps: whole.minFps,
      wholeAvgFps: whole.avgFps,
      gameMinFps: game.minFps,
      gameAvgFps: game.avgFps,
    };
  } finally {
    await browser.close();
  }
};

beforeAll(() => {
  if (!chromiumAvailable) return;
  expect(shippedBand).not.toBe("");
});

test.skipIf(!chromiumAvailable)(
  "keeps the delivered picture moving for the health check",
  async () => {
    for (const background of BACKGROUNDS) {
      const summary = await measure(background, true);
      // 検知の判定としきい値そのもので採点する。
      expect(isFpsAboveThreshold(summary.wholeMinFps, VIDEO_MIN_FPS)).toBe(
        true,
      );
      expect(isFpsAboveThreshold(summary.gameMinFps, GAME_MIN_FPS)).toBe(true);
    }
  },
  180_000,
);

test.skipIf(!chromiumAvailable)(
  "reports a frozen picture without the heartbeat band",
  async () => {
    // 帯が無いと絵は止まったままになり、検知は停止として報告する。帯が
    // 映像を動かす側だと分かる対照。
    const summary = await measure(BACKGROUNDS[0] ?? "", false);
    expect(summary.wholeMinFps).toBe(0);
    expect(summary.gameMinFps).toBe(0);
    expect(isFpsAboveThreshold(summary.wholeMinFps, VIDEO_MIN_FPS)).toBe(false);
  },
  180_000,
);
