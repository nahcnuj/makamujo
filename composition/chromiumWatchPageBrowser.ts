/**
 * `composition/watchPageBrowser.ts` の Playwright（Chromium）実装。
 *
 * このリポジトリで Chromium を動かして通っている統合テスト
 * (`tests/integration/vigilant-fiesta-play-loop.test.ts`) と同じく、素の
 * `playwright` を使う。`watchPageStatisticsSource` からは必要なときだけ
 * 動的 import するので、reader を無効にした環境では Playwright をロードしない。
 */

import { chromium } from "playwright";
import {
  isCapturableMediaSource,
  isInAdContainer,
} from "../scripts/check-stream";
import {
  isWatchPageReadable,
  type PictureMotion,
  selectMeasurableVideo,
  toDisplayedStatistics,
  type WatchPageBrowser,
  type WatchPageRawReading,
} from "./watchPageBrowser";

const NAVIGATION_TIMEOUT_MS = 60_000;
/** ブラウザ起動の応答が無いと気付けないため、必ず上限を効かせる。 */
const LAUNCH_TIMEOUT_MS = 60_000;
/** 統計行が `-` から値に埋まるまでの待ち。超過しても読取自体は続行する。 */
const STATISTICS_READY_TIMEOUT_MS = 10_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/*
 * 配信映像の動きの測定（`measurePictureMotion`）。判定の根拠（動画の選別、
 * 広告の除外、ピクセルの比較のしきい値）は配信異常検知の権威である
 * `scripts/check-stream.ts` の unit test 済み関数 (`isCapturableMediaSource`,
 * `isInAdContainer`) を文字列化してページ側に注入する形で借りる。チェックス
 * クリプト自体は改変しない（issue #807 契約）。
 */
const MOTION_WINDOW_MS = 3_000;
/** 統計用ブラウザは 1600x900 で、全画面の 1/12 程度に縮めて比較する。 */
const MOTION_MAX_DIMENSION = 128;
/** この差を超えたピクセルは「変わった」と数える。 */
const MOTION_CHANNEL_TOLERANCE = 16;
/** 全ピクセルのうちこの割合を超えて変わったフレームだけを差分として数える。 */
const MOTION_MIN_CHANGED_RATIO = 0.001;
/** rAF が一切来ない（レンダラ停止）ときでも絶対に帰る上限。 */
const MOTION_EVALUATE_TIMEOUT_MS = MOTION_WINDOW_MS + 5_000;

/** ページ側の動画選別ヘルパーを置く。navigation で消えるので毎回入れる。 */
const installVideoSelectors = (page: import("playwright").Page) =>
  page.evaluate(`
(() => {
  const isCapturable = ${isCapturableMediaSource.toString()};
  const isInAd = ${isInAdContainer.toString()};
  const selectMeasurableVideo = ${selectMeasurableVideo.toString()};
  const origin = location.origin;
  const isSized = (v) => v.videoWidth > 0 && v.readyState >= 2;
  const inAdContainer = (v) => {
    let cur = v;
    while (cur && cur !== document.body) {
      if (isInAd(String(cur.className || "") + " " + String(cur.id || ""))) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  };
  window.__mmjSelectCapturableVideo = () => {
    const videos = Array.from(document.querySelectorAll("video"));
    const capturable = videos.filter(
      (v) => isCapturable(v.currentSrc || v.src || "", origin) && !inAdContainer(v),
    );
    return selectMeasurableVideo(capturable) ?? null;
  };
  window.__mmjIsAdvertisementPlaying = () =>
    Array.from(document.querySelectorAll("video")).some(
      (v) => !isCapturable(v.currentSrc || v.src || "", origin) && v.paused === false && isSized(v),
    );
})()
`);

/**
 * 1 窓の間、縮小した配信映像を rAF のたびに比較する。
 * `scripts/check-stream.ts` のサンプラーと同じ骨格の、全部画面バージョン
 * （ゲーム画面クリップの区別は不要）。無音・未再生・要素再構築では対象が
 * 取れないので空測定を返し、判定は呼び出し側に委ねる。
 */
const sampleMotionWindow = async ({
  durationMs,
  maxDimension,
  channelTolerance,
  minChangedRatio,
}: {
  durationMs: number;
  maxDimension: number;
  channelTolerance: number;
  minChangedRatio: number;
}): Promise<PictureMotion> => {
  const unmoving = (): PictureMotion => ({
    comparedFrames: 0,
    changedFrames: 0,
    windowMs: 0,
    tainted: false,
    sawAdvertisement: false,
  });
  const startProbe = window.__mmjSelectCapturableVideo?.();
  if (!startProbe?.videoWidth || !startProbe.videoHeight) {
    return unmoving();
  }
  const scale = Math.min(
    1,
    maxDimension / Math.max(startProbe.videoWidth, startProbe.videoHeight),
  );
  const width = Math.max(1, Math.round(startProbe.videoWidth * scale));
  const height = Math.max(1, Math.round(startProbe.videoHeight * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return unmoving();
  }
  let previous: Uint8ClampedArray | null = null;
  let comparedFrames = 0;
  let changedFrames = 0;
  let tainted = false;
  let sawAdvertisement = false;
  const start = performance.now();
  try {
    await new Promise<void>((resolve) => {
      const deadline = start + durationMs;
      const safety = setTimeout(resolve, durationMs + 2_000);
      const tick = () => {
        const now = performance.now();
        if (now >= deadline) {
          clearTimeout(safety);
          resolve();
          return;
        }
        if (window.__mmjIsAdvertisementPlaying?.()) {
          sawAdvertisement = true;
        }
        try {
          const video = window.__mmjSelectCapturableVideo?.();
          // 再構築の途中で要素が消えうる。比較対象を落とさず待つ。
          if (video?.videoWidth && video.videoHeight) {
            context.drawImage(video, 0, 0, width, height);
            const current = context.getImageData(0, 0, width, height).data;
            if (previous) {
              let changed = 0;
              const total = width * height;
              for (let p = 0; p < total; p++) {
                const i = p * 4;
                const redDiff = Math.abs(
                  (previous[i] ?? 0) - (current[i] ?? 0),
                );
                const greenDiff = Math.abs(
                  (previous[i + 1] ?? 0) - (current[i + 1] ?? 0),
                );
                const blueDiff = Math.abs(
                  (previous[i + 2] ?? 0) - (current[i + 2] ?? 0),
                );
                if (
                  redDiff > channelTolerance ||
                  greenDiff > channelTolerance ||
                  blueDiff > channelTolerance
                ) {
                  changed += 1;
                }
              }
              comparedFrames += 1;
              if (changed / total > minChangedRatio) {
                changedFrames += 1;
              }
            }
            previous = current;
          }
        } catch {
          // このコールバック内の例外は await された promise を reject しない。
          tainted = true;
          clearTimeout(safety);
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } catch {
    return {
      comparedFrames,
      changedFrames,
      windowMs: performance.now() - start,
      tainted: true,
      sawAdvertisement,
    };
  }
  return {
    comparedFrames,
    changedFrames,
    windowMs: performance.now() - start,
    tainted,
    sawAdvertisement,
  };
};

/**
 * 統計行の表示テキストを読む。クラス名にはビルド用ハッシュが付くため部分一致で探す。
 * 値が `-` のまま（JS がまだ埋めていない / ページに無い）場合はそのまま文字列を返す。
 */
const readDisplayedValues = (): WatchPageRawReading => {
  const readItem = (className: string): string | null => {
    const item = document.querySelector(`[class*="${className}"]`);
    const inner = item?.querySelector("[class*='inner-content']");
    const text = inner?.textContent?.trim();
    return text !== undefined && text.length > 0 ? text : null;
  };
  return {
    statistics: {
      viewers: readItem("watch-count-item"),
      comments: readItem("comment-count-item"),
      nicoadPoints: readItem("nicoad-count-item"),
      giftPoints: readItem("gift-count-item"),
    },
    hasStatisticsRow:
      document.querySelector('[class*="watch-count-item"]') !== null,
  };
};

/** 統計行に値が入った（`data-blank` が false になった）のを待つ。 */
const waitForStatistics = (page: import("playwright").Page) =>
  page
    .waitForFunction(
      () => {
        const item = document.querySelector('[class*="watch-count-item"]');
        return (
          item?.querySelector("button, span")?.getAttribute("data-blank") ===
          "false"
        );
      },
      undefined,
      { timeout: STATISTICS_READY_TIMEOUT_MS },
    )
    .catch(() => {
      // 値が埋まらないまま（`-`）でも採取自体は続行する。次の採取で最新になる。
    });

export const createChromiumWatchPageBrowser =
  async (): Promise<WatchPageBrowser> => {
    // 各段階をログに残す。ブラウザの起動や navigation が応答しないで
    // 止まったときに、どこで止まったかが特定できるようにするため。
    console.log("[INFO] launching chromium for the niconama watch page...");
    const browser = await chromium.launch({
      headless: true,
      timeout: LAUNCH_TIMEOUT_MS,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "ja-JP",
      viewport: { width: 1600, height: 900 },
    });
    const page = await context.newPage();
    console.log("[INFO] chromium launched for the niconama watch page");
    let lastReadLog: string | undefined;

    return {
      open: async (watchPageUrl) => {
        console.log(`[INFO] opening the watch page: ${watchPageUrl}`);
        const response = await page.goto(watchPageUrl, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
        console.log(
          `[INFO] watch page opened (status=${response?.status() ?? "unknown"}, url=${page.url()})`,
        );
        await waitForStatistics(page);
        console.log("[INFO] watch page statistics settled");
      },
      read: async () => {
        const raw = await page.evaluate(readDisplayedValues);
        // 採取は短い周期で回るので、同じ内容ならログを出さない。
        const readLog = JSON.stringify(raw.statistics);
        if (readLog !== lastReadLog) {
          lastReadLog = readLog;
          console.log(`[INFO] read the watch page (statistics=${readLog})`);
        }
        if (!isWatchPageReadable(raw)) {
          // 配信ページを見ていない（空 / エラーページ / JS 実行前）。
          // ここを throw にしておくと source 側が直前の値を保持し、
          // CI ログに原因が出る。黙って値を消さない。
          throw new Error(
            `the niconama watch page has no statistics row (url=${page.url()}, title=${JSON.stringify(
              await page.title().catch(() => ""),
            )}, statistics=${readLog})`,
          );
        }
        return toDisplayedStatistics(raw);
      },
      // ページ実体が生きているかのみを報告する。`open` に失敗した実体は
      // source が破棄するので、ここで未オープンを区別する必要はない。
      isAlive: () => browser.isConnected() && !page.isClosed(),
      measurePictureMotion: async () => {
        await installVideoSelectors(page);
        // レンダラが固まっていると evaluate が帰らない可能性がある。待ちの
        // 上限を置いて、帰らなければ「測れなかった」に落とす。
        return Promise.race([
          page.evaluate(sampleMotionWindow, {
            durationMs: MOTION_WINDOW_MS,
            maxDimension: MOTION_MAX_DIMENSION,
            channelTolerance: MOTION_CHANNEL_TOLERANCE,
            minChangedRatio: MOTION_MIN_CHANGED_RATIO,
          }),
          new Promise<PictureMotion>((resolve) =>
            globalThis.setTimeout(resolve, MOTION_EVALUATE_TIMEOUT_MS, {
              comparedFrames: 0,
              changedFrames: 0,
              windowMs: 0,
              tainted: false,
              sawAdvertisement: false,
            }),
          ),
        ]);
      },
      discard: async () => {
        try {
          await browser.close();
        } catch {
          /* ignore */
        }
      },
    };
  };
