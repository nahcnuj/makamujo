/**
 * 統計の供給源。index.ts からブラウザの配線とログ制御を追い出す。
 *
 * ページは一度だけ開き、以降は開いたまま統計行の表示テキストを読み直す
 * （ページ自身が WebSocket で更新するため）。採取周期ごとに再読み込みはしない。
 * 読み取りに失敗しても開いたページは開き直したり閉じたりしない（普通に視聴
 * するときと同じ）。作り直すのは `isAlive()` が false（実体が落ちた）か、
 * `open` に失敗したときだけで、公開中の値は失敗中も直前のものを保つ（勝手
 * には空にしない）。
 *
 * 差し替え口は `createBrowser`（ブラウザ実体そのもの）であって URL ではない。
 * テストは `NICONAMA_WATCH_PAGE_DISABLED=1` で全体を無効化するか、
 * `createBrowser` を差し替えてローカルページを読ませることができる。
 */

import type { DisplayedStatistics } from "../lib/domain/broadcasting/watchPageStatistics";
import {
  DEFAULT_NICONAMA_WATCH_PAGE_URL,
  WATCH_PAGE_READ_INTERVAL_MS,
  type WatchPageBrowser,
} from "./watchPageBrowser";

export type WatchPageStatisticsSourceOptions = {
  /** 差し替え口。省略時は Chromium で実ページを読む。 */
  createBrowser?: () => Promise<WatchPageBrowser>;
  watchPageUrl?: string;
  readIntervalMs?: number;
  /** true なら何もせず何もしない。`POST /api/meta` へフォールバックする。 */
  disabled?: boolean;
  env?: Record<string, string | undefined>;
  log?: Pick<Console, "log" | "warn" | "error">;
  onStatistics: (statistics: DisplayedStatistics) => void;
};

export type WatchPageStatisticsSource = {
  /** 1 回目の採取まで解決する。開始に失敗しても reject しない。 */
  ready: Promise<void>;
  /** 1 回だけ採取する。 */
  readOnce: () => Promise<void>;
  stop: () => Promise<void>;
};

const parseInterval = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * 同じ失敗のログを連打しないための簡易スロットル。
 * 失敗が続く場合に 1 回目の直後と、その後は 10 回ごとに出す。
 */
const createFailureLogger = (
  warn: (...args: unknown[]) => void,
  message: string,
) => {
  let count = 0;
  return (error: unknown) => {
    count += 1;
    if (count !== 1 && count % 10 !== 0) {
      return;
    }
    warn(
      `${message} (${count} times):`,
      error instanceof Error ? error.message : String(error),
    );
  };
};

export const startWatchPageStatisticsSource = (
  options: WatchPageStatisticsSourceOptions,
): WatchPageStatisticsSource => {
  const env = options.env ?? process.env;
  const log = options.log ?? console;
  const disabled = options.disabled ?? env.NICONAMA_WATCH_PAGE_DISABLED === "1";

  if (disabled) {
    log.log(
      "[INFO] watch page statistics source is disabled; falling back to POST /api/meta",
    );
    return {
      ready: Promise.resolve(),
      readOnce: async () => {},
      stop: async () => {},
    };
  }

  const watchPageUrl =
    options.watchPageUrl ??
    env.NICONAMA_WATCH_PAGE_URL?.trim() ??
    DEFAULT_NICONAMA_WATCH_PAGE_URL;
  const readIntervalMs = parseInterval(
    env.NICONAMA_WATCH_PAGE_READ_INTERVAL_MS,
    options.readIntervalMs ?? WATCH_PAGE_READ_INTERVAL_MS,
  );
  const reportFailure = createFailureLogger(
    (...args) => log.warn(...args),
    "[WARN] failed to read the niconama watch page",
  );

  let stopped = false;
  let reading = false;
  let browser: WatchPageBrowser | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const createChromiumBrowser = async (): Promise<WatchPageBrowser> =>
    options.createBrowser
      ? await options.createBrowser()
      : // Playwright を含む実装だけ動的 import する。差し替えが無いテストでは
        // Chromium 側を一切ロードしない。
        await (
          await import("./chromiumWatchPageBrowser")
        ).createChromiumWatchPageBrowser();

  /**
   * 開いたままのブラウザを返す。`isAlive()` が false（実体が落ちた）ときだけ
   * 破棄して作り直し、ページを開き直す。ページが読めないだけの失敗では開いた
   * まま維持する。`open` に失敗した実体は未オープンのまま残さず破棄する。
   */
  const ensureAliveBrowser = async (): Promise<WatchPageBrowser> => {
    if (browser?.isAlive()) {
      return browser;
    }
    await browser?.discard();
    const created = await createChromiumBrowser();
    browser = created;
    try {
      await created.open(watchPageUrl);
    } catch (error) {
      await created.discard();
      browser = undefined;
      throw error;
    }
    return created;
  };

  const readOnce = async (): Promise<void> => {
    if (reading || stopped) {
      return;
    }
    reading = true;
    try {
      const current = await ensureAliveBrowser();
      options.onStatistics(await current.read());
    } catch (error) {
      // ページが読めないだけの失敗では開いたページはそのまま使う。普通に視聴
      // するときにブラウザを開いたり閉じたりしないのと同じ理屈。実体が落ちた
      // 場合や `open` に失敗した場合は ensureAliveBrowser が破棄するので、
      // 次の採取で作り直される。
      reportFailure(error);
    } finally {
      reading = false;
    }
  };

  const run = async () => {
    try {
      log.log(`[INFO] watch page statistics source started: ${watchPageUrl}`);
      await readOnce();
      if (!stopped) {
        timer = setInterval(() => {
          void readOnce();
        }, readIntervalMs);
      }
    } catch (error) {
      log.error(
        "[ERROR] failed to start the watch page statistics source:",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
  };

  return {
    ready: run(),
    readOnce,
    stop: async () => {
      stopped = true;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      const current = browser;
      browser = undefined;
      await current?.discard();
    },
  };
};
