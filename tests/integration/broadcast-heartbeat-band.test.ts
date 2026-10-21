import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium } from "playwright";
import {
  bandKeepsPictureMoving,
  parseHeartbeatBandSpec,
} from "../../lib/domain/broadcasting/broadcastHeartbeatBand";
import { compileTailwindCss } from "../../lib/tailwind";
import {
  GAME_CLIP,
  GAME_MIN_FPS,
  isFpsAboveThreshold,
  type MotionSample,
  summarizeFps,
  VIDEO_MIN_FPS,
} from "../../scripts/check-stream";

/**
 * 配信映像の鼓動帯が、検知側の閾値を実際に満たすことの統合テスト。
 *
 * 外からの異常検知 (`scripts/check-stream.ts`) は、届いた絵を 128x72 に
 * 落として前フレームと channel 差 16 を超えたピクセルの割合が 0.001 を超え
 * たフレームを「動いた」と数え、1 秒バケットごとに最少の移動フレーム数を
 * 出す。映像全体は 24 fps 超（左 60% のゲーム画面は 8 fps 超）が必要で、
 * owner の要求は「映像全体が常に 24 fps 以上」である。
 *
 * 帯はそれ以外の Seconds すべてが静止しているときでも合成出力を動かすため
 * の唯一の手段で、帯が画面外に出た瞬間は 1 秒バケットを 24 fps 未満に
 * 落として「映像全体が停止している」という誤った検知を生む
 * (issue #1005: 2026-10-21 22:27 から 2026-10-22 04:23 まで映像全体と
 * ゲーム画面が数時間止まったまま外からの検知だけが残った)。
 *
 * ここでは実ブラウザ (OBS の browser source と同じ Chromium) で
 * 配信ページを描画し、検知側と同じ計算で「動いたフレーム」を数える:
 *
 * - 配信ページは本番と同じ HTML シェルとコンパイル済み CSS を使う。アプリ
 *   の JS (`frontend.js`) は配信しない。帯は JS を経由しないので、アプリが
 *   描画できなくても動き続けることを確かめるためでもある。
 * - 1 フレームごとに CSS アニメーションをそのフレームの時刻で停止させ、
 *   合成された絵を 128x72 に落として前フレームと比べる。映像は 30 fps なので
 *   1 フレーム = 1/30 秒。1 周期 (片道 + 折り返し) を測って 10 秒窓へ
 *   タイルし、検知側の `summarizeFps` で 1 秒バケットの最少値を出す。
 * - 背景は 2 通りで測る。OBS は Comment browser source に黒の Color Key を
 *   掛けているので、配信画では黒い背景は消えてゲーム画面が透ける。帯は
 *   ゲーム画面の上にも-over cribed- 載るため、明るい背景でも同じ判定が
 *   成立することを確認する。
 *
 * Chromium が起動できない環境では skip する。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/** OBS の Comment browser source が描画するサイズ。 */
const VIEWPORT = { width: 1280, height: 720 } as const;
/** 配信するフレームレート。 */
const FPS = 30;
/** 検知側の縮小後の絵の大きさ (`scripts/check-stream.ts` の MAX_SAMPLE_DIMENSION)。 */
const SAMPLE_WIDTH = 128;
const SAMPLE_HEIGHT = 72;
/** 検知側の channel 差の許容 (`scripts/check-stream.ts` の PIXEL_CHANNEL_TOLERANCE)。 */
const CHANNEL_TOLERANCE = 16;
/** 検知側の「動いた」とみなすピクセルの割合 (`scripts/check-stream.ts` の MIN_CHANGED_RATIO)。 */
const MIN_CHANGED_RATIO = 0.001;
/** 検知側の 1 秒バケット (ms)。 */
const BUCKET_MS = 1000;
/** 検知側の測定窓 (ms)。 */
const WINDOW_MS = 10_000;

interface FrameFlags {
  /** The whole downsized frame differs from the previous frame. */
  whole: boolean;
  /** The left game-panel region differs from the previous frame. */
  game: boolean;
}

interface BandRect {
  top: number;
  height: number;
}

/** Chromium がこの環境で起動できるか（skip 判定）。 */
const chromiumAvailable = await (async (): Promise<boolean> => {
  try {
    const probe = await chromium.launch({
      headless: true,
      timeout: 60_000,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    await probe.close();
    return true;
  } catch (error) {
    console.warn(
      "[TEST DIAG] chromium unavailable; heartbeat band integration test will be skipped:",
      error instanceof Error ? error.message.split("\n")[0] : String(error),
    );
    return false;
  }
})();

let server: Server | undefined;
let port = 0;
let browser: Browser | undefined;
let stylesheet = "";

beforeAll(async () => {
  if (!chromiumAvailable) {
    return;
  }
  stylesheet = await compileTailwindCss("src/index.css");
  const html = readFileSync(
    join(repoRoot, "src", "index.html"),
    "utf8",
  ).replace(/src=(['"])\.\/frontend\.tsx\1/, "src=$1./frontend.js$1");
  server = createServer((req, res) => {
    if (req.url === "/index.css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      res.end(stylesheet);
      return;
    }
    if (req.url === "/frontend.js") {
      // アプリの JS は配信しない。帯は JS を経由せず動く。
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((resolve) => server?.listen(0, () => resolve()));
  ({ port } = server.address() as AddressInfo);
  browser = await chromium.launch({
    headless: true,
    timeout: 60_000,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
});

/** 起動済みの Chromium を返す（beforeAll が失敗していたら throw する）。 */
const requireBrowser = (): Browser => {
  if (!browser) {
    throw new Error("the browser is not running");
  }
  return browser;
};

/**
 * 1 周期ぶんを測って、検知側の 1 秒バケットで最少の移動フレーム数を出す。
 *
 * サンプルは映像の 30 fps と同じ間隔で取る。帯のアニメーションは周期的なので、
 * 1 周期の測定を 10 秒窓へタイルしても検知側の集計と同じ結果になる。
 */
const measureBand = async (
  background: string,
): Promise<{
  samples: MotionSample[];
  video: ReturnType<typeof summarizeFps>;
  game: ReturnType<typeof summarizeFps>;
  rects: BandRect[];
}> => {
  const spec = parseHeartbeatBandSpec(stylesheet);
  const legMs = spec.legDurationMs;
  const periodMs = spec.alternate ? legMs * 2 : legMs;
  const periodFrames = Math.round((periodMs / 1000) * FPS);

  const page = await requireBrowser().newPage({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
  });
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.addStyleTag({
      content: `:root { background-color: ${background} !important; }`,
    });
    // 検知側の page.evaluate と同じ比較をページ内で行う。
    await page.evaluate(
      ({
        sampleWidth,
        sampleHeight,
        channelTolerance,
        minChangedRatio,
        gameWidth,
      }: {
        sampleWidth: number;
        sampleHeight: number;
        channelTolerance: number;
        minChangedRatio: number;
        gameWidth: number;
      }) => {
        const scope = window as unknown as {
          __mmjSample?: (base64: string) => Promise<FrameFlags>;
        };
        const canvas = new OffscreenCanvas(sampleWidth, sampleHeight);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("no 2d context");
        let previous: Uint8ClampedArray | null = null;
        scope.__mmjSample = async (base64: string): Promise<FrameFlags> => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
          const current = context.getImageData(
            0,
            0,
            sampleWidth,
            sampleHeight,
          ).data;
          const before = previous;
          previous = current;
          if (!before) {
            return { whole: false, game: false };
          }
          let wholeDiff = 0;
          let gameDiff = 0;
          for (let p = 0; p < sampleWidth * sampleHeight; p++) {
            const i = p * 4;
            const redDiff = Math.abs((before[i] ?? 0) - (current[i] ?? 0));
            const greenDiff = Math.abs(
              (before[i + 1] ?? 0) - (current[i + 1] ?? 0),
            );
            const blueDiff = Math.abs(
              (before[i + 2] ?? 0) - (current[i + 2] ?? 0),
            );
            if (
              redDiff > channelTolerance ||
              greenDiff > channelTolerance ||
              blueDiff > channelTolerance
            ) {
              wholeDiff += 1;
              if (p % sampleWidth < gameWidth) gameDiff += 1;
            }
          }
          return {
            whole: wholeDiff / (sampleWidth * sampleHeight) > minChangedRatio,
            game: gameDiff / (gameWidth * sampleHeight) > minChangedRatio,
          };
        };
      },
      {
        sampleWidth: SAMPLE_WIDTH,
        sampleHeight: SAMPLE_HEIGHT,
        channelTolerance: CHANNEL_TOLERANCE,
        minChangedRatio: MIN_CHANGED_RATIO,
        gameWidth: Math.max(1, Math.floor(SAMPLE_WIDTH * GAME_CLIP.widthRatio)),
      },
    );

    const samples: MotionSample[] = [];
    const rects: BandRect[] = [];
    for (let frame = 0; frame <= periodFrames; frame++) {
      // アニメーションをそのフレームの時刻で止める。描画はアプリから独立している。
      const rect = await page.evaluate(
        (timeMs: number): BandRect => {
          const band = document.getElementById("broadcast-heartbeat");
          if (!band) throw new Error("the heartbeat band is missing");
          const animation = band.getAnimations()[0];
          if (!animation)
            throw new Error("the heartbeat band does not animate");
          animation.pause();
          animation.currentTime = timeMs;
          const box = band.getBoundingClientRect();
          return { top: box.top, height: box.height };
        },
        (frame * 1000) / FPS,
      );
      rects.push(rect);
      const png = await page.screenshot({ type: "png" });
      const flags = await page.evaluate(
        async (base64: string): Promise<FrameFlags> => {
          const scope = window as unknown as {
            __mmjSample?: (base64: string) => Promise<FrameFlags>;
          };
          if (!scope.__mmjSample) throw new Error("the sampler is missing");
          return scope.__mmjSample(base64);
        },
        png.toString("base64"),
      );
      if (frame === 0) {
        // 先頭は前フレームが無いので比較しない（検知側も同じ）。
        continue;
      }
      samples.push({
        elapsedMs: ((frame - 1) * 1000) / FPS,
        wholeChanged: flags.whole,
        gameChanged: flags.game,
      });
    }

    // 1 周期の測定を 10 秒窓へタイルする。
    const windowFrames = Math.round((WINDOW_MS / 1000) * FPS);
    const tiled: MotionSample[] = [];
    for (let index = 0; index < windowFrames; index++) {
      const source = samples[index % samples.length];
      tiled.push({
        elapsedMs: (index * 1000) / FPS,
        wholeChanged: source?.wholeChanged ?? false,
        gameChanged: source?.gameChanged ?? false,
      });
    }
    const video = summarizeFps(
      tiled,
      (sample) => sample.wholeChanged,
      BUCKET_MS,
      WINDOW_MS,
    );
    const game = summarizeFps(
      tiled,
      (sample) => sample.gameChanged,
      BUCKET_MS,
      WINDOW_MS,
    );
    console.info(
      `[TEST DIAG] background=${background} video.minFps=${video.minFps} video.avgFps=${video.avgFps} game.minFps=${game.minFps} game.avgFps=${game.avgFps}`,
    );
    return { samples: tiled, video, game, rects };
  } finally {
    await page.close();
  }
};

test.skipIf(!chromiumAvailable)(
  "keeps the delivered picture above the detector's thresholds",
  async () => {
    const measured = await measureBand("#000000");
    // 帯は画面内に残り、検知側の 1 秒バケットで 24 枚以上、1 フレームも
    // 止まらない。帯が画面外に出ると最少値が 24 を下回り「停止」と判定される。
    expect(isFpsAboveThreshold(measured.video.minFps, VIDEO_MIN_FPS)).toBe(
      true,
    );
    expect(isFpsAboveThreshold(measured.video.avgFps, VIDEO_MIN_FPS)).toBe(
      true,
    );
    // ゲーム画面（左 60%）も同じ帯が横切る。
    expect(isFpsAboveThreshold(measured.game.minFps, GAME_MIN_FPS)).toBe(true);
    expect(isFpsAboveThreshold(measured.game.avgFps, GAME_MIN_FPS)).toBe(true);
  },
  180_000,
);

test.skipIf(!chromiumAvailable)(
  "keeps the delivered picture moving over a bright background",
  async () => {
    // OBS の Color Key (key = 黒) で黒い背景は消え、ゲーム画面が透ける。
    // 帯はゲーム画面の上にも載るので、明るい背景でも同じ判定が成立する。
    const measured = await measureBand("#c0c0c0");
    expect(isFpsAboveThreshold(measured.video.minFps, VIDEO_MIN_FPS)).toBe(
      true,
    );
    expect(isFpsAboveThreshold(measured.game.minFps, GAME_MIN_FPS)).toBe(true);
  },
  180_000,
);

test.skipIf(!chromiumAvailable)(
  "keeps the band inside the viewport for the whole sweep",
  async () => {
    const measured = await measureBand("#000000");
    for (const rect of measured.rects) {
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.top + rect.height).toBeLessThanOrEqual(VIEWPORT.height);
    }
    // 帯は 1 フレームごとに 1 標本行より速く動く。
    const spec = parseHeartbeatBandSpec(stylesheet);
    expect(bandKeepsPictureMoving(spec, VIEWPORT.height)).toBe(true);
  },
  180_000,
);
