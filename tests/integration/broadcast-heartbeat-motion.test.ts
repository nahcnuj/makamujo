import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createChromiumWatchPageBrowser } from "../../composition/chromiumWatchPageBrowser";
import { judgePictureMotion } from "../../composition/watchPageBrowser";
import {
  DEFAULT_HEARTBEAT_LIVENESS_OPTIONS,
  HEARTBEAT_GAME_MIN_FPS,
  HEARTBEAT_VIDEO_MIN_FPS,
  type HeartbeatSample,
  summarizeHeartbeatBuckets,
} from "../../lib/domain/broadcasting/broadcastHeartbeatLiveness";

/** ページ側に置き、テストから呼び出す測定。 */
declare global {
  interface Window {
    __mmjMeasureMotion?: (options: {
      durationMs: number;
      maxDimension: number;
      channelTolerance: number;
      minChangedRatio: number;
      gameWidthRatio: number;
    }) => Promise<HeartbeatSample[]>;
  }
}

/**
 * 配信映像の鼓動（帯）の統合テスト。
 *
 * 2026-10-22 06:25 の停止（issue #1009）では、音声と media clock が進み
 * 続けていたのに映像の全フレームが同じで、外からの異常検知が
 * `videoMinFps = 0` / `gameMinFps = 0` を返した。帯はそれを避けるための
 * もので、`src/index.css` の形と `src/index.html` の静的な要素をそのまま
 * 使い、実ブラウザで描画した絵を `scripts/check-stream.ts` と同じ手順で
 * 測る。ここでは次を見る。
 *
 * - 本番の測定（`WatchPageBrowser.measurePictureMotion`）が帯のある映像を
 *   「動いている」と判定すること。
 * - 検知と同じ閾値（標本 128px、差 16、0.1%）で、1 秒バケットごとに
 *   全体 24 枚以上・ゲーム部分 8 枚以上のフレームが動いていること。
 * - 帯が画面外に出る瞬間が無いこと（帯が画面内に居るあいだは、1 フレーム
 *   あたり標本の 2 行以上動くので、必ず差分になる）。
 *
 * 帯は OBS の browser source と同じく「画面（黒）の上に描かれ、Color Key
 * （黒）が暗い画素を消す」つもりで描く。ゲーム画面の背景は #0f1419 なので
 * 不透明な中核は消えない。
 *
 * Chromium が起動できない環境では skip する。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, "..", "..");

const html = readFileSync(join(repositoryRoot, "src", "index.html"), "utf8");
const css = readFileSync(join(repositoryRoot, "src", "index.css"), "utf8");

/** `src/index.html` の帯の要素。そのまま使う。 */
const bandMarkup =
  /<div class="broadcast-heartbeat"[^>]*><\/div>/.exec(html)?.[0] ?? "";

/** `src/index.css` の帯の定義（keyframes と rule）。そのまま使う。 */
const bandCss = (() => {
  const keyframes =
    /@keyframes\s+broadcast-heartbeat-sweep\s*\{[\s\S]*?\n\}/.exec(css)?.[0];
  const rule = /\.broadcast-heartbeat\s*\{[\s\S]*?\n\}/.exec(css)?.[0];
  if (keyframes === undefined || rule === undefined) {
    throw new Error("the heartbeat band CSS was not found");
  }
  return `${keyframes}\n${rule}`;
})();

/**
 * ページ側のスクリプト。帯の位置は実際の DOM（実 CSS のアニメーション）から
 * 読み、色は `getComputedStyle` の実際の gradient から読む。帯は OBS の
 * browser source と同じく画面（黒）の上に描かれ、Color Key（黒）が暗い画素
 * を消すので、暗い画素はゲーム画面をそのまま残す。
 */
const PAGE_SCRIPT = `
  // OBS の Color Key（黒）が消す目安。ゲーム画面の背景（#0f1419）はこれより
  // 明るいので中核は消されず、帯の縁（透過）は消される。
  const KEY_LUMA = 64;
  // ゲーム画面の背景色。
  const BACKGROUND = "#0f1419";

  const canvas = document.getElementById("c");
  const context = canvas.getContext("2d");
  const band = document.querySelector(".broadcast-heartbeat");
  const video = document.getElementById("v");
  video.srcObject = canvas.captureStream(30);
  // 統計用ブラウザと同じく、計測前に再生を明示して止める。
  video.play().catch(() => {});

  const parseStops = (gradient) => {
    const stops = [];
    // 計算済みの値は不透明な色が "rgb(r, g, b)" になる（"rgba(r, g, b, a)" ではない）。
    const pattern =
      /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)\\s+([\\d.]+)%/g;
    for (const matched of gradient.matchAll(pattern)) {
      stops.push({
        color: {
          r: Number.parseInt(matched[1], 10),
          g: Number.parseInt(matched[2], 10),
          b: Number.parseInt(matched[3], 10),
        },
        alpha: matched[4] === undefined ? 1 : Number.parseFloat(matched[4]),
        percent: Number.parseFloat(matched[5]),
      });
    }
    return stops;
  };

  const sampleGradient = (stops, position) => {
    const percent = position * 100;
    let lower = stops[0];
    let upper = stops[stops.length - 1];
    for (let index = 0; index < stops.length - 1; index += 1) {
      const current = stops[index];
      const next = stops[index + 1];
      if (current !== undefined && next !== undefined &&
          percent >= current.percent && percent <= next.percent) {
        lower = current;
        upper = next;
        break;
      }
    }
    const span = upper.percent - lower.percent;
    const ratio = span <= 0 ? 0 : (percent - lower.percent) / span;
    return {
      color: {
        r: lower.color.r + (upper.color.r - lower.color.r) * ratio,
        g: lower.color.g + (upper.color.g - lower.color.g) * ratio,
        b: lower.color.b + (upper.color.b - lower.color.b) * ratio,
      },
      alpha: lower.alpha + (upper.alpha - lower.alpha) * ratio,
    };
  };

  const stops = parseStops(getComputedStyle(band).backgroundImage);

  const draw = () => {
    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const rect = band.getBoundingClientRect();
    const scale = canvas.height / window.innerHeight;
    const bandTop = rect.top * scale;
    const bandHeight = rect.height * scale;
    const first = Math.max(0, Math.floor(bandTop));
    const last = Math.min(canvas.height - 1, Math.ceil(bandTop + bandHeight));
    for (let y = first; y <= last; y += 1) {
      const position = (y - bandTop) / bandHeight;
      if (position < 0 || position > 1) continue;
      const stop = sampleGradient(stops, position);
      const red = stop.color.r * stop.alpha;
      const green = stop.color.g * stop.alpha;
      const blue = stop.color.b * stop.alpha;
      // OBS の Color Key（黒）が消す画素はゲーム画面がそのまま残る。
      if (0.299 * red + 0.587 * green + 0.114 * blue < KEY_LUMA) continue;
      context.fillStyle = "rgb(" + red + "," + green + "," + blue + ")";
      context.fillRect(0, y, canvas.width, 1);
    }
    requestAnimationFrame(draw);
  };
  draw();

  // 検知と同じ手順で映像を測る: 標本を 128px へ縮め、前標本と比較し、
  // 差 16 を超える画素が 0.1% 以上あるフレームを「動いた」と数える。
  window.__mmjMeasureMotion = (options) => {
    return new Promise((resolve) => {
      const width = options.maxDimension;
      const height = Math.round(
        (width * video.videoHeight) / video.videoWidth,
      );
      const gameWidth = Math.round(width * options.gameWidthRatio);
      const sampler = document.createElement("canvas");
      sampler.width = width;
      sampler.height = height;
      const samplerContext = sampler.getContext("2d", {
        willReadFrequently: true,
      });
      const samples = [];
      let previous = null;
      const start = performance.now();
      const tick = () => {
        const now = performance.now();
        if (now - start >= options.durationMs) {
          resolve(samples);
          return;
        }
        samplerContext.drawImage(video, 0, 0, width, height);
        const current = samplerContext.getImageData(0, 0, width, height).data;
        if (previous !== null) {
          let whole = 0;
          let game = 0;
          for (let pixel = 0; pixel < width * height; pixel += 1) {
            const index = pixel * 4;
            const changed =
              Math.abs(previous[index] - current[index]) >
                options.channelTolerance ||
              Math.abs(previous[index + 1] - current[index + 1]) >
                options.channelTolerance ||
              Math.abs(previous[index + 2] - current[index + 2]) >
                options.channelTolerance;
            if (!changed) continue;
            whole += 1;
            if (pixel % width < gameWidth) game += 1;
          }
          samples.push({
            elapsedMs: now - start,
            wholeChanged:
              whole / (width * height) > options.minChangedRatio,
            gameChanged:
              game / (gameWidth * height) > options.minChangedRatio,
          });
        }
        previous = current;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };
`;

const PAGE = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>heartbeat motion</title>
    <style>
      html { background: #000; }
      body { margin: 0; overflow: hidden; }
      ${bandCss}
    </style>
  </head>
  <body>
    ${bandMarkup}
    <canvas id="c" width="1280" height="720"></canvas>
    <video id="v" autoplay muted playsinline></video>
    <script>
      ${PAGE_SCRIPT}
    </script>
  </body>
</html>`;

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
      "[TEST DIAG] chromium unavailable; heartbeat integration test will be skipped:",
      error instanceof Error ? error.message.split("\n")[0] : String(error),
    );
    return false;
  }
})();

beforeAll(async () => {
  if (!chromiumAvailable) {
    return;
  }
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server?.listen(0, () => resolve()));
  ({ port } = server.address() as AddressInfo);
});

afterAll(() => {
  server?.close();
});

test.skipIf(!chromiumAvailable)(
  "keeps the delivered picture moving with the heartbeat band",
  async () => {
    const browser = await createChromiumWatchPageBrowser();
    try {
      await browser.open(`http://127.0.0.1:${port}/`);
      const motion = await browser.measurePictureMotion?.();
      if (motion === undefined) {
        throw new Error("the browser cannot measure the picture motion");
      }
      expect(motion.tainted).toBe(false);
      expect(motion.comparedFrames).toBeGreaterThanOrEqual(5);
      // 本番の判定でも「動いている」こと。
      expect(judgePictureMotion(motion)).toBe("moving");
    } finally {
      await browser.discard();
    }
  },
  120_000,
);

test.skipIf(!chromiumAvailable)(
  "keeps every one second bucket above the check thresholds",
  async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      timeout: 60_000,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      });
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForFunction(() => {
        const video = document.querySelector("video");
        return video !== null && video.videoWidth > 0;
      });
      const samples = await page.evaluate(
        async (options) => {
          const measure = window.__mmjMeasureMotion;
          if (measure === undefined) {
            throw new Error("the page has no motion measurement");
          }
          return await measure(options);
        },
        {
          durationMs: 10_000,
          maxDimension: DEFAULT_HEARTBEAT_LIVENESS_OPTIONS.maxSampleDimension,
          channelTolerance: DEFAULT_HEARTBEAT_LIVENESS_OPTIONS.channelTolerance,
          minChangedRatio: DEFAULT_HEARTBEAT_LIVENESS_OPTIONS.minChangedRatio,
          gameWidthRatio: DEFAULT_HEARTBEAT_LIVENESS_OPTIONS.gameWidthRatio,
        },
      );
      expect(samples.length).toBeGreaterThan(100);
      const buckets = summarizeHeartbeatBuckets(
        samples,
        DEFAULT_HEARTBEAT_LIVENESS_OPTIONS,
      );
      expect(buckets.length).toBe(10);
      for (const bucket of buckets) {
        expect(bucket.wholeChangedFrames).toBeGreaterThanOrEqual(
          HEARTBEAT_VIDEO_MIN_FPS,
        );
        expect(bucket.gameChangedFrames).toBeGreaterThanOrEqual(
          HEARTBEAT_GAME_MIN_FPS,
        );
      }
    } finally {
      await browser.close();
    }
  },
  120_000,
);
