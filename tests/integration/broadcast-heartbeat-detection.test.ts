import { describe, expect, it, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROADCAST_HEARTBEAT_SAMPLE_MAX_DIMENSION,
  BROADCAST_HEARTBEAT_SAMPLE_ROWS,
  DEFAULT_HEARTBEAT_BAND_GEOMETRY,
  heartbeatMovementPxPerFrame,
  keepsSampleRowMargin,
  sampleRowHeightPx,
} from "../../lib/domain/broadcasting/broadcastHeartbeat";
import { compileTailwindCss } from "../../lib/tailwind";
import {
  GAME_MIN_FPS,
  isFpsAboveThreshold,
  type MotionSample,
  summarizeFps,
  VIDEO_MIN_FPS,
} from "../../scripts/check-stream";

/**
 * 配信映像の鼓動（帯）が外からの異常検知に拾われることの統合テスト。
 *
 * 帯は「合成出力が止まらない」ための保険で、乱暴に弱くすると配信が生きて
 * いても停止と数えられる。外からの検知（`scripts/check-stream.ts`。owner
 * 契約 #807 により改変しない）は映像を 128x72 の標本へ落とし、隣接する
 * 標本の差がチャネル許容差 16 を超えた画素が 0.1% 以上あるフレームを
 * 「動いた」と数え、1 秒バケットで 24 枚以上（ゲーム部分は 8 枚以上）動かな
 * ければ停止とみなす。
 *
 * ここでは本番と同じ絵を使う: shipping される CSS（`src/index.css` を
 * Tailwind でコンパイルしたもの）と shipping される帯の要素
 * （`src/index.html`）を読み、1280x720 で描画して、OBS の browser source が
 * 30fps で配信する絵を再現する。採った絵は検知と同じ手順（128x72 へ縮小し
 * て隣接標本を比べる）で判定する。ゲーム画面は止まった絵として背景に置き、
 * 「ゲームが止まっていても帯が配信を動かし続ける」ことを測る。
 *
 * Chromium が起動できない環境では skip する。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, "..", "..");

/** 本番の OBS の browser source と同じ設定（1280x720 / 30fps）。 */
const PICTURE_WIDTH = 1280;
const PICTURE_HEIGHT = 720;
const DELIVERY_FPS = 30;

/** 検知側の定数（`scripts/check-stream.ts` と同じ値）。 */
const PIXEL_CHANNEL_TOLERANCE = 16;
const MIN_CHANGED_RATIO = 0.001;

/** ゲーム部分として切り出す幅（左 60%）。 */
const GAME_WIDTH_RATIO = 0.6;

/** 1 バケット（1 秒）あたりの標本数。 */
const BUCKET_MS = 1_000;

/** 測定する窓の長さ（ミリ秒）。 */
const WINDOW_MS = 2_000;

/** ゲームが止まった絵（止まった背景の上に帯だけが流れる）。 */
const FROZEN_GAME_BACKGROUND =
  "radial-gradient(circle at 30% 20%, #14532d 0%, #052e16 45%, #021a0d 100%)";

/** shipping される帯の要素。 */
const readBandMarkup = (): string => {
  const html = readFileSync(join(repositoryRoot, "src", "index.html"), "utf8");
  const markup = html.match(
    /<div[^>]*class="broadcast-heartbeat"[^>]*><\/div>/,
  )?.[0];
  if (markup === undefined) {
    throw new Error(
      "src/index.html has no static broadcast heartbeat element; the band must not depend on the app's JS",
    );
  }
  return markup;
};

/** Chromium がこの環境で起動できるか（skip 判定）。 */
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
      "[TEST DIAG] chromium unavailable; the broadcast heartbeat detection test will be skipped:",
      error instanceof Error ? error.message.split("\n")[0] : String(error),
    );
    return false;
  }
})();

/**
 * 1280x720 のページを 30fps の配信として採り、検知と同じ手順で標本を比べる。
 *
 * 描画は本番と同じ CSS と同じ要素を使う。帯のアニメーションは止めておき、
 * 配信の 1 フレームごとに `currentTime` を進めてから絵を採る。こうすると
 * 採る絵は「30fps で配信された絵」と同じになり、採取側のフレームレートに
 * 左右されない（描画が遅い環境で結果がぶれない）。
 *
 * 標本の比較は検知と同じ手順で行う: 128x72 へ描いて、隣接する標本のチャネル
 * 差が許容差 16 を超える画素が 0.1% 以上あれば「動いた」と数える。
 */
const measureDeliveredPicture = async (): Promise<{
  samples: MotionSample[];
  minChangedRatio: number;
}> => {
  const { chromium } = await import("playwright");
  const css = await compileTailwindCss("src/index.css");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: PICTURE_WIDTH, height: PICTURE_HEIGHT },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.setContent(
      `<!doctype html><html><head><style>${css}</style></head>` +
        `<body style="margin:0;overflow:hidden;background:${FROZEN_GAME_BACKGROUND}">` +
        `${readBandMarkup()}</body></html>`,
    );
    await page.waitForTimeout(300);

    // 帯のアニメーションを止める（配信の 1 フレームごとに手进水させるため）。
    const paused = await page.evaluate(() => {
      const band = document.querySelector(".broadcast-heartbeat");
      const animation =
        band instanceof HTMLElement ? (band.getAnimations()[0] ?? null) : null;
      if (!animation) return false;
      animation.pause();
      return true;
    });
    if (!paused) {
      throw new Error(
        "the broadcast heartbeat band has no animation; the shipped CSS must keep the sweep",
      );
    }

    // 配信の 1 フレームごとの絵を採る（OBS の browser source は 30fps）。
    const frames: string[] = [];
    for (let tick = 0; tick * (1000 / DELIVERY_FPS) < WINDOW_MS; tick += 1) {
      const elapsedMs = tick * (1000 / DELIVERY_FPS);
      await page.evaluate(async (timeMs: number) => {
        const band = document.querySelector(".broadcast-heartbeat");
        const animation =
          band instanceof HTMLElement
            ? (band.getAnimations()[0] ?? null)
            : null;
        animation?.pause();
        if (animation) animation.currentTime = timeMs;
        // 描画が終わってから絵を採る。
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      }, elapsedMs);
      const screenshot = await page.screenshot({ type: "png" });
      frames.push(screenshot.toString("base64"));
    }

    // 標本の比較は検知と同じ手順で行う: 128x72 へ描いて、隣接する標本の
    // チャネル差が許容差を超える画素の割合で「動いた」と数える。
    await page.evaluate(
      (config) => {
        const state = { previous: null as Uint8ClampedArray | null };
        const canvas = document.createElement("canvas");
        canvas.width = config.sampleWidth;
        canvas.height = config.sampleRows;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        const compare = async (dataUrl: string) => {
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
          const previous = state.previous;
          state.previous = current;
          if (!previous) return null;
          let whole = 0;
          let game = 0;
          const gameWidth = Math.floor(
            config.sampleWidth * config.gameWidthRatio,
          );
          const pixelCount = config.sampleWidth * config.sampleRows;
          for (let pixel = 0; pixel < pixelCount; pixel += 1) {
            const index = pixel * 4;
            const red = Math.abs(
              (previous[index] ?? 0) - (current[index] ?? 0),
            );
            const green = Math.abs(
              (previous[index + 1] ?? 0) - (current[index + 1] ?? 0),
            );
            const blue = Math.abs(
              (previous[index + 2] ?? 0) - (current[index + 2] ?? 0),
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
            whole: whole / pixelCount,
            game: game / (gameWidth * config.sampleRows),
          };
        };
        (
          globalThis as unknown as {
            __mmjCompare: (
              url: string,
            ) => Promise<{ whole: number; game: number } | null>;
          }
        ).__mmjCompare = compare;
      },
      {
        sampleWidth: BROADCAST_HEARTBEAT_SAMPLE_MAX_DIMENSION,
        sampleRows: BROADCAST_HEARTBEAT_SAMPLE_ROWS,
        channelTolerance: PIXEL_CHANNEL_TOLERANCE,
        gameWidthRatio: GAME_WIDTH_RATIO,
      },
    );

    const samples: MotionSample[] = [];
    const ratios: number[] = [];
    for (const [index, data] of frames.entries()) {
      const result = await page.evaluate(
        (dataUrl: string) =>
          (
            globalThis as unknown as {
              __mmjCompare: (
                url: string,
              ) => Promise<{ whole: number; game: number } | null>;
            }
          ).__mmjCompare(dataUrl),
        `data:image/png;base64,${data}`,
      );
      if (result === null) continue;
      ratios.push(result.whole);
      samples.push({
        elapsedMs: index * (1000 / DELIVERY_FPS),
        wholeChanged: result.whole > MIN_CHANGED_RATIO,
        gameChanged: result.game > MIN_CHANGED_RATIO,
      });
    }
    return {
      samples,
      minChangedRatio: ratios.length > 0 ? Math.min(...ratios) : 0,
    };
  } finally {
    await browser.close();
  }
};

describe("broadcast heartbeat", () => {
  it("moves the band by more than one sample row per delivered frame", () => {
    // 検知は映像を 128x72 に落とすので、720px の画面では標本 1 行 = 10px。
    // これより遅いと落とした標本が隣のフレームと同じになり、止まった絵と
    // 区別できなくなる。
    const movement = heartbeatMovementPxPerFrame(
      DEFAULT_HEARTBEAT_BAND_GEOMETRY,
    );
    expect(movement).toBeGreaterThan(
      sampleRowHeightPx(
        DEFAULT_HEARTBEAT_BAND_GEOMETRY.pictureHeightPx,
        DEFAULT_HEARTBEAT_BAND_GEOMETRY.sampleRows,
      ),
    );
    expect(keepsSampleRowMargin(DEFAULT_HEARTBEAT_BAND_GEOMETRY)).toBe(true);
    expect(BROADCAST_HEARTBEAT_SAMPLE_MAX_DIMENSION).toBe(128);
    expect(BROADCAST_HEARTBEAT_SAMPLE_ROWS).toBe(72);
  });

  it("ships the band as a static element outside the app root", () => {
    const html = readFileSync(
      join(repositoryRoot, "src", "index.html"),
      "utf8",
    );
    const rootIndex = html.indexOf('<div id="root">');
    const bandIndex = html.indexOf('class="broadcast-heartbeat"');
    expect(rootIndex).toBeGreaterThanOrEqual(0);
    expect(bandIndex).toBeGreaterThan(rootIndex);
    // 帯はアプリの JS が描かなくても残る：中身は root の中だけで、帯は
    // 兄弟要素として置かれている。
    expect(html).toContain('<div id="root"></div>');
  });

  test.skipIf(!chromiumAvailable)(
    "keeps the delivered picture moving while the game is frozen",
    async () => {
      const { samples, minChangedRatio } = await measureDeliveredPicture();
      expect(samples.length).toBeGreaterThan(10);
      // 標本の差は閾値を大きく超える（帯が動けば絵が変わる）。
      expect(minChangedRatio).toBeGreaterThan(MIN_CHANGED_RATIO);

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
      // 1 秒バケットの最少値でも閾値を超えること（平均では隠れる）。
      expect(isFpsAboveThreshold(whole.minFps, VIDEO_MIN_FPS)).toBe(true);
      expect(isFpsAboveThreshold(game.minFps, GAME_MIN_FPS)).toBe(true);
    },
    120_000,
  );
});
