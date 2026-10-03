/**
 * 統計の供給源。index.ts から reader の配線とログ制御を追い出す。
 *
 * 差し替え口は `createSession`（reader そのもの）であって URL ではない。
 * テストは `NICONAMA_WATCH_PAGE_DISABLED=1` で全体を無効化するか、
 * `createSession` を差し替えてローカルページを読ませることができる。
 */

import type { DisplayedStatistics } from "../lib/domain/broadcasting/watchPageStatistics";
import {
  DEFAULT_NICONAMA_WATCH_PAGE_URL,
  startWatchPageBrowserReader,
  WATCH_PAGE_READ_INTERVAL_MS,
  type WatchPageBrowserReader,
  type WatchPageSession,
} from "./watchPageBrowserReader";

export type WatchPageStatisticsSourceOptions = {
  /** 差し替え口。省略時は Playwright で実ページを読む reader。 */
  createSession?: () => Promise<WatchPageSession>;
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
    return { ready: Promise.resolve(), stop: async () => {} };
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
  let reader: WatchPageBrowserReader | undefined;

  const run = async () => {
    try {
      // Playwright を含むセッション実装だけ動的 import する。差し替えが無い
      // テストでは reader 側を一切ロードしない。
      const createSession =
        options.createSession ??
        (await import("./watchPageBrowserSession"))
          .createPlaywrightWatchPageSession;
      if (stopped) {
        return;
      }
      reader = startWatchPageBrowserReader({
        watchPageUrl,
        intervalMs: readIntervalMs,
        createSession,
        onStatistics: options.onStatistics,
        onError: reportFailure,
      });
      log.log(`[INFO] watch page statistics source started: ${watchPageUrl}`);
      await reader.readOnce();
    } catch (error) {
      log.error(
        "[ERROR] failed to start the watch page statistics source:",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
  };

  return {
    ready: run(),
    stop: async () => {
      stopped = true;
      await reader?.stop();
    },
  };
};
