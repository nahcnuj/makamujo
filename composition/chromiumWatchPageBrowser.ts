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
  isWatchPageReadable,
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
      close: async () => {
        try {
          await browser.close();
        } catch {
          /* ignore */
        }
      },
    };
  };
