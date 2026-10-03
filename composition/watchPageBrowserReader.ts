/**
 * 番組配信ページの**描画済み画面**から統計を読むリーダー。
 *
 * 配信ページの統計行（視聴者数 / コメント数 / ニコニコ広告ポイント / ギフトポイント）は
 * HTML には `-` プレースホルダしか無く、JS が unama WebSocket を受けたあとで埋まる。
 * したがってブラウザでページを開いたまま統計行の**表示テキスト**を読む。
 *
 * Playwright には依存しない（`createSession` を差し替えられる）。実際のブラウザ実装は
 * `composition/watchPageBrowserSession.ts` にあり、必要なときだけ動的 import する。
 */

import {
  type DisplayedStatistics,
  type DisplayedStatisticsTexts,
  parseDisplayedStatistics,
} from "../lib/domain/broadcasting/watchPageStatistics";

/** ページが更新する仕組みが 30〜60 秒粒度なので、デフォルトは 30 秒。 */
export const WATCH_PAGE_READ_INTERVAL_MS = 30_000;

/**
 * 本番で読む配信ページ。**固定値**。ここを変える必要があるなら
 * 環境変数 `NICONAMA_WATCH_PAGE_URL`（テスト専用の差し替え口）を使う。
 */
export const DEFAULT_NICONAMA_WATCH_PAGE_URL =
  "https://live.nicovideo.jp/watch/user/14171889";

/** ブラウザ実体から切り離したセッション。差し替え・単体テストが可能。 */
export type WatchPageSession = {
  /** 配信ページを開き、統計行が描画されるまで待つ。 */
  open: (watchPageUrl: string) => Promise<void>;
  /** いま画面に表示されている値を採取する。 */
  read: () => Promise<DisplayedStatistics>;
  close: () => Promise<void>;
};

/** `page.evaluate` が返す、生の表示テキスト一式。 */
export type WatchPageRawReading = {
  statistics: DisplayedStatisticsTexts;
  /** 統計行が DOM に並んでいるか。 */
  hasStatisticsRow: boolean;
};

/**
 * ページが配信ページとして読めたか。`false` は空ページ / エラーページ /
 * JS 実行前で、統計行を一度も見ていない状態。
 */
export const isWatchPageReadable = (raw: WatchPageRawReading): boolean =>
  raw.hasStatisticsRow;

/** 生サンプル → ドメイン値。ブラウザ無しで単体テストできる。 */
export const toDisplayedStatistics = (
  raw: WatchPageRawReading,
): DisplayedStatistics => parseDisplayedStatistics(raw.statistics);

export type WatchPageBrowserReaderOptions = {
  watchPageUrl: string;
  intervalMs?: number;
  createSession: () => Promise<WatchPageSession>;
  onStatistics: (statistics: DisplayedStatistics) => void;
  onError?: (error: unknown) => void;
};

export type WatchPageBrowserReader = {
  /** 1 回だけ採取する。 */
  readOnce: () => Promise<void>;
  stop: () => Promise<void>;
};

export const startWatchPageBrowserReader = (
  options: WatchPageBrowserReaderOptions,
): WatchPageBrowserReader => {
  const intervalMs = options.intervalMs ?? WATCH_PAGE_READ_INTERVAL_MS;
  let session: WatchPageSession | undefined;
  let opened = false;
  let running = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const discardSession = async () => {
    const current = session;
    session = undefined;
    opened = false;
    try {
      await current?.close();
    } catch {
      /* ignore */
    }
  };

  const readOnce = async (): Promise<void> => {
    if (running || stopped) {
      return;
    }
    running = true;
    try {
      session ??= await options.createSession();
      if (!opened) {
        await session.open(options.watchPageUrl);
        opened = true;
      }
      options.onStatistics(await session.read());
    } catch (error) {
      // ブラウザが落ちた / ページが変わった等等。次の採取で作り直す。
      options.onError?.(error);
      await discardSession();
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => {
    void readOnce();
  }, intervalMs);

  return {
    readOnce,
    stop: async () => {
      stopped = true;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      await discardSession();
    },
  };
};
