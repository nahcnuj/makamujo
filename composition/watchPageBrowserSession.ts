/**
 * `composition/watchPageBrowserReader.ts` の Playwright 実装。
 *
 * AGT と同じ `playwright-extra` + stealth プラグインを使う（ニコニコの-bot 判定回避）。
 * `index.ts` からは必要なときだけ動的 import するので、reader を無効にした環境では
 * Playwright を一切ロードしない。
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import {
  toWatchPageSnapshot,
  type WatchPageSession,
} from "./watchPageBrowserReader";

const NAVIGATION_TIMEOUT_MS = 60_000;
/** 統計行が `-` から値に埋まるまでの待ち。超過しても読取自体は続行する。 */
const STATISTICS_READY_TIMEOUT_MS = 30_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let stealthInstalled = false;
const ensureStealth = () => {
  if (stealthInstalled) {
    return;
  }
  chromium.use(StealthPlugin());
  stealthInstalled = true;
};

/**
 * 統計行の表示テキストを読む。クラス名にはビルド用ハッシュが付くため部分一致で探す。
 * 値が `-` のまま（JS がまだ埋めていない / ページに無い）場合はそのまま文字列を返す。
 */
const readDisplayedValues = () => {
  const readItem = (className: string): string | null => {
    const item = document.querySelector(`[class*="${className}"]`);
    const inner = item?.querySelector("[class*='inner-content']");
    const text = inner?.textContent?.trim();
    return text !== undefined && text.length > 0 ? text : null;
  };
  const embeddedData = document
    .querySelector("script#embedded-data")
    ?.getAttribute("data-props");
  return {
    statistics: {
      viewers: readItem("watch-count-item"),
      comments: readItem("comment-count-item"),
      nicoadPoints: readItem("nicoad-count-item"),
      giftPoints: readItem("gift-count-item"),
      timeshiftReservations: readItem("timeshift-reservation-count-item"),
    },
    embeddedData: embeddedData ?? null,
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

export const createPlaywrightWatchPageSession =
  async (): Promise<WatchPageSession> => {
    ensureStealth();
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "ja-JP",
      viewport: { width: 1600, height: 900 },
    });
    const page = await context.newPage();

    return {
      open: async (watchPageUrl) => {
        await page.goto(watchPageUrl, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
        await waitForStatistics(page);
      },
      read: async () =>
        toWatchPageSnapshot(await page.evaluate(readDisplayedValues)),
      close: async () => {
        try {
          await browser.close();
        } catch {
          /* ignore */
        }
      },
    };
  };
