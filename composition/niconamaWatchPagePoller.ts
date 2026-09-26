/**
 * 番組配信ページの poller: `NICONAMA_WATCH_PAGE_URL` を定期取得し、
 * ページに埋め込まれた番組情報を `onProgram` に通知する。
 *
 * ページ側の集計は 30〜60 秒単位でしか更新されないので、デフォルトは 30 秒。
 * 取得に失敗した場合は直前の状態を壊さないよう `onError` に通知するだけで留まる。
 */

import {
  parseWatchPageProgram,
  type WatchPageProgram,
} from "../lib/domain/broadcasting/watchPageProgram";

/** 実測したページ更新の細かさに合わせて 30 秒。 */
export const NICONAMA_WATCH_PAGE_POLL_INTERVAL_MS = 30_000;
export const NICONAMA_WATCH_PAGE_TIMEOUT_MS = 10_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type NiconamaWatchPagePollerOptions = {
  watchPageUrl: string;
  intervalMs?: number;
  timeoutMs?: number;
  /** Test seam. 既定はグローバル fetch。 */
  fetchImpl?: typeof fetch;
  /** 番組情報。`undefined` は「配信ページ上に番組が無い」を意味する。 */
  onProgram: (program: WatchPageProgram | undefined) => void;
  /** 取得失敗時。前の状態は保持される。 */
  onError?: (error: unknown) => void;
};

export type NiconamaWatchPagePoller = {
  stop: () => void;
  /** 1 回だけ即時取得する（テストや起動直後の，反映待ち回避用）。 */
  pollOnce: () => Promise<void>;
};

/**
 * 配信ページ 1 枚から番組情報を読む。通信エラーは投げ、番組情報が無い場合は undefined。
 */
export const fetchWatchPageProgram = async (
  watchPageUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = NICONAMA_WATCH_PAGE_TIMEOUT_MS,
): Promise<WatchPageProgram | undefined> => {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(watchPageUrl, {
      headers: { "user-agent": USER_AGENT },
      signal: abortController.signal,
    });
    const html = await response.text();
    return parseWatchPageProgram(html);
  } finally {
    clearTimeout(timeoutId);
  }
};

export const startNiconamaWatchPagePoller = (
  options: NiconamaWatchPagePollerOptions,
): NiconamaWatchPagePoller => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const intervalMs = options.intervalMs ?? NICONAMA_WATCH_PAGE_POLL_INTERVAL_MS;
  let running = false;
  let stopped = false;

  const pollOnce = async (): Promise<void> => {
    if (running || stopped) {
      return;
    }
    running = true;
    try {
      options.onProgram(
        await fetchWatchPageProgram(
          options.watchPageUrl,
          fetchImpl,
          options.timeoutMs,
        ),
      );
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void pollOnce();
  }, intervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    pollOnce,
  };
};
