import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 出荷する配信ページに beating band があることの統合テスト。
 *
 * 外からの配信異常検知（`scripts/check-stream.ts` は改変しない: owner 契約
 * #807）は 10 秒窓を 1 秒バケットに切り、各バケットで 24 枚以上（ゲーム部分は
 * 左 60% で 8 枚以上）変化したフレームを要求する。比較は 128x72 に縮めた絵を
 * 1 サンプル行ずつ行い、この差を超えたピクセルの割合が 0.1% を超えるフレーム
 * だけを「変化」と数える。
 *
 * ここでは出荷する HTML をそのまま描画し、検知と同じ手順・同じしきい値で採点
 * する。帯は「配信が生きている」ことを映像で示す最後の砦なので、アプリの
 * バンドルが読めず描画が例外で止まっても（このテストでは JS も CSS も読ませ
 * ない）、帯だけは動いて検知に届くことを確かめる。
 *
 * サンプリングは 1 配信フレーム（30fps = 33.333ms）ずつ進める。帯が 1 フレ
 * ームで 1 サンプル行以上動かなければ、縮めの丸めやエンコードの平滑化で差が
 * 消えて停止と数えられる（issue #1021: `videoMinFps = 0` / `gameMinFps = 0`）。
 * 帯が無い対照ページでは同じ測定が 0 になることも確かめる。
 *
 * Chromium が起動できない環境では skip する。
 */

const here = dirname(fileURLToPath(import.meta.url));
const shippingHtml = readFileSync(
  join(here, "..", "..", "src", "index.html"),
  "utf8",
);

const BAND_MARKUP =
  '<div class="broadcast-heartbeat" aria-hidden="true"></div>';

/** 検知側の標本の寸法（128x72）。 */
const SAMPLE_WIDTH = 128;
const SAMPLE_HEIGHT = 72;
/** 検知側のゲーム領域（画面の左 60%）。 */
const GAME_WIDTH_RATIO = 0.6;
/** 検知側「この差を超えたピクセルは変わった」と数えるしきい値。 */
const CHANNEL_TOLERANCE = 16;
/** 検知側「変わった」と数えるピクセルの割合のしきい値。 */
const MIN_CHANGED_RATIO = 0.001;
/** 配信のフレームレート。 */
const DELIVERY_FPS = 30;
/** 1 配信フレームの長さ（ms）。 */
const FRAME_MS = 1000 / DELIVERY_FPS;
/** 1 秒ぶん（折り返しを含む）をサンプルする枚数。 */
const SAMPLE_COUNT = 32;

type Shot = { label: string; base64: string };

type PairResult = {
  from: string;
  to: string;
  wholeChangedRatio: number;
  gameChangedRatio: number;
};

let server: Server | undefined;
let port = 0;

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
      "[TEST DIAG] chromium unavailable; the heartbeat detection integration test will be skipped:",
      error instanceof Error ? error.message.split("\n")[0] : String(error),
    );
    return false;
  }
})();

beforeAll(async () => {
  if (!chromiumAvailable) return;
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    // 出荷する HTML のそのまま。CSS ファイルとバンドルは読ませない（404）。
    // 帯はそれらと独立に動くべきだから。
    let html = shippingHtml;
    if (url === "/control" || url === "/control-dark") {
      html = html.replace(BAND_MARKUP, "");
    }
    if (url === "/dark" || url === "/control-dark") {
      // 出荷する CSS が入れば背景は黒になる（`:root { bg-black }`）。
      html = html.replace(
        "</head>",
        "  <style>html { background-color: #000; }</style>\n</head>",
      );
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((resolve) => server?.listen(0, () => resolve()));
  ({ port } = server.address() as AddressInfo);
});

afterAll(() => {
  server?.close();
});

/**
 * 指定した時刻で帯を止めて、画面の絵を撮る。帯のアニメーションを止めて
 * 時刻を直接指定するので、サンプル間の差が「1 配信フレームだけ進んだ」差
 * になる。帯が無いページ（対照）では時刻指定を諦めてそのまま撮る。
 */
const captureFrames = async (
  page: import("playwright").Page,
  times: number[],
): Promise<{ shots: Shot[]; animationFound: boolean }> => {
  const shots: Shot[] = [];
  let animationFound = false;
  for (const time of times) {
    const found = await page.evaluate(async (target) => {
      const animation = document
        .getAnimations()
        .find(
          (candidate) =>
            (candidate as CSSAnimation).animationName ===
            "broadcast-heartbeat-sweep",
        );
      if (!animation) return false;
      animation.pause();
      animation.currentTime = target;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      return true;
    }, time);
    animationFound = animationFound || found;
    const buffer = await page.screenshot({ type: "png" });
    shots.push({ label: `${time}ms`, base64: buffer.toString("base64") });
  }
  return { shots, animationFound };
};

/**
 * 検知と同じ手順で絵を比べる。128x72 に縮め、この差を超えたピクセルの割合を
 * 全体とゲーム領域（左 60%）で数える。`compress` を立てると同じ絵を JPEG
 * （品質 0.75）で一度往復させ、配信のエンコードで差が薄まる様子も見る。
 */
const compareShots = async (
  page: import("playwright").Page,
  shots: Shot[],
  compress: boolean,
): Promise<PairResult[]> =>
  page.evaluate(
    async ({
      shots,
      compress,
      sampleWidth,
      sampleHeight,
      gameWidthRatio,
      channelTolerance,
    }): Promise<PairResult[]> => {
      const decode = async (base64: string): Promise<ImageBitmap> => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return createImageBitmap(new Blob([bytes], { type: "image/png" }));
      };

      const toSample = async (
        bitmap: ImageBitmap,
      ): Promise<Uint8ClampedArray> => {
        const canvas = document.createElement("canvas");
        canvas.width = sampleWidth;
        canvas.height = sampleHeight;
        const context = canvas.getContext("2d", {
          willReadFrequently: true,
        });
        if (!context) throw new Error("no 2d context");
        context.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);
        return context.getImageData(0, 0, sampleWidth, sampleHeight).data;
      };

      const toJpeg = async (bitmap: ImageBitmap): Promise<ImageBitmap> => {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.drawImage(bitmap, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        return createImageBitmap(image);
      };

      const gameWidth = Math.max(1, Math.floor(sampleWidth * gameWidthRatio));
      const total = sampleWidth * sampleHeight;
      const results: PairResult[] = [];
      let previous: Uint8ClampedArray | undefined;
      let previousLabel = "";
      for (const shot of shots) {
        const bitmap = await decode(shot.base64);
        const source = compress ? await toJpeg(bitmap) : bitmap;
        const current = await toSample(source);
        if (previous) {
          let wholeDiff = 0;
          let gameDiff = 0;
          for (let pixel = 0; pixel < total; pixel += 1) {
            const index = pixel * 4;
            const redDiff = Math.abs(
              (previous[index] ?? 0) - (current[index] ?? 0),
            );
            const greenDiff = Math.abs(
              (previous[index + 1] ?? 0) - (current[index + 1] ?? 0),
            );
            const blueDiff = Math.abs(
              (previous[index + 2] ?? 0) - (current[index + 2] ?? 0),
            );
            if (
              redDiff > channelTolerance ||
              greenDiff > channelTolerance ||
              blueDiff > channelTolerance
            ) {
              wholeDiff += 1;
              if (pixel % sampleWidth < gameWidth) gameDiff += 1;
            }
          }
          results.push({
            from: previousLabel,
            to: shot.label,
            wholeChangedRatio: wholeDiff / total,
            gameChangedRatio: gameDiff / (gameWidth * sampleHeight),
          });
        }
        previous = current;
        previousLabel = shot.label;
      }
      return results;
    },
    {
      shots,
      compress,
      sampleWidth: SAMPLE_WIDTH,
      sampleHeight: SAMPLE_HEIGHT,
      gameWidthRatio: GAME_WIDTH_RATIO,
      channelTolerance: CHANNEL_TOLERANCE,
    },
  );

/** 出荷するページを開いて、帯のアニメーションが出るまで待つ。 */
const openShippingPage = async (
  browser: import("playwright").Browser,
  path: string,
): Promise<import("playwright").Page> => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}${path}`, {
    waitUntil: "domcontentloaded",
  });
  return page;
};

test.skipIf(!chromiumAvailable)(
  "shows the shipped page as moving on every delivered frame",
  async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      timeout: 60_000,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await openShippingPage(browser, "/");
      const times = Array.from(
        { length: SAMPLE_COUNT },
        (_, index) => index * FRAME_MS,
      );
      const { shots, animationFound } = await captureFrames(page, times);
      expect(animationFound).toBe(true);
      const pairs = await compareShots(page, shots, false);
      expect(pairs.length).toBe(SAMPLE_COUNT - 1);
      for (const pair of pairs) {
        // 検知は 1 バケット（1 秒）あたり 24 枚以上の変化を要求する。1 フレ
        // ームで 1 サンプル行以上動かなければ、縮めと平滑化で差が消える。
        expect(
          pair.wholeChangedRatio,
          `the whole picture did not change between ${pair.from} and ${pair.to}`,
        ).toBeGreaterThan(MIN_CHANGED_RATIO);
        expect(
          pair.gameChangedRatio,
          `the game crop did not change between ${pair.from} and ${pair.to}`,
        ).toBeGreaterThan(MIN_CHANGED_RATIO);
      }
    } finally {
      await browser.close();
    }
  },
  180_000,
);

test.skipIf(!chromiumAvailable)(
  "keeps the movement after the encoder smooths the picture",
  async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      timeout: 60_000,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await openShippingPage(browser, "/dark");
      const times = Array.from(
        { length: SAMPLE_COUNT },
        (_, index) => index * FRAME_MS,
      );
      const { shots, animationFound } = await captureFrames(page, times);
      expect(animationFound).toBe(true);
      const pairs = await compareShots(page, shots, true);
      expect(pairs.length).toBe(SAMPLE_COUNT - 1);
      for (const pair of pairs) {
        expect(
          pair.wholeChangedRatio,
          `the whole picture did not change between ${pair.from} and ${pair.to}`,
        ).toBeGreaterThan(MIN_CHANGED_RATIO);
        expect(
          pair.gameChangedRatio,
          `the game crop did not change between ${pair.from} and ${pair.to}`,
        ).toBeGreaterThan(MIN_CHANGED_RATIO);
      }
    } finally {
      await browser.close();
    }
  },
  180_000,
);

test.skipIf(!chromiumAvailable)(
  "measures a page without the band as still",
  async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      timeout: 60_000,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      for (const path of ["/control", "/control-dark"]) {
        const page = await openShippingPage(browser, path);
        const { shots, animationFound } = await captureFrames(page, [
          0,
          FRAME_MS,
        ]);
        expect(animationFound).toBe(false);
        const pairs = await compareShots(page, shots, false);
        expect(pairs.length).toBe(1);
        expect(pairs[0]?.wholeChangedRatio ?? 1).toBeLessThanOrEqual(
          MIN_CHANGED_RATIO,
        );
        expect(pairs[0]?.gameChangedRatio ?? 1).toBeLessThanOrEqual(
          MIN_CHANGED_RATIO,
        );
      }
    } finally {
      await browser.close();
    }
  },
  180_000,
);
