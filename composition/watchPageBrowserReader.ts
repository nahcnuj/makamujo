/**
 * 番組配信ページの**描画済み画面**から番組情報を読むリーダー。
 *
 * 配信ページの統計行（視聴者数 / コメント数 / ニコニコ広告ポイント / ギフトポイント）は
 * HTML には `-` プレースホルダしか無く、JS が unama WebSocket を受けたあとで埋まる。
 * したがってブラウザでページを開いたまま統計行の**表示テキスト**を読む。
 *
 * Playwright には依存しない（`createSession` を差し替えられる）。実際のブラウザ実装は
 * `composition/watchPageBrowserSession.ts` にあり、必要なときだけ動的 import する。
 */

import {
  parseWatchPageProgramProps,
  type WatchPageProgram,
} from "../lib/domain/broadcasting/watchPageProgram";
import {
  type DisplayedStatistics,
  type DisplayedStatisticsTexts,
  parseDisplayedStatistics,
} from "../lib/domain/broadcasting/watchPageStatistics";

/** ページが更新する仕組みが 30〜60 秒粒度なので、デフォルトは 30 秒。 */
export const WATCH_PAGE_READ_INTERVAL_MS = 30_000;

/** 1 回の採取で得る値。 */
export type WatchPageSnapshot = {
  /** ページに番組が無い（=`undefined`）ときは配信していない扱い。 */
  program: WatchPageProgram | undefined;
  /** 統計行の表示テキストを数値化したもの。値が無い項目はキーごと無い。 */
  statistics: DisplayedStatistics;
};

/** ブラウザ実体から切り離したセッション。差し替え・単体テストが可能。 */
export type WatchPageSession = {
  /** 配信ページを開き、統計行が描画されるまで待つ。 */
  open: (watchPageUrl: string) => Promise<void>;
  /** いま画面に表示されている値を採取する。 */
  read: () => Promise<WatchPageSnapshot>;
  close: () => Promise<void>;
};

/** `page.evaluate` が返す、生の表示テキスト一式。 */
export type WatchPageRawReading = {
  statistics: DisplayedStatisticsTexts;
  /** `embedded-data` の `data-props`（ブラウザ内では既にデコード済み）。 */
  embeddedData?: string | null;
};

/** 生サンプル → ドメイン値。ブラウザ無しで単体テストできる。 */
export const toWatchPageSnapshot = (
  raw: WatchPageRawReading,
): WatchPageSnapshot => ({
  program:
    raw.embeddedData === null || raw.embeddedData === undefined
      ? undefined
      : parseWatchPageProgramProps(raw.embeddedData),
  statistics: parseDisplayedStatistics(raw.statistics),
});

export type WatchPageBrowserReaderOptions = {
  watchPageUrl: string;
  intervalMs?: number;
  createSession: () => Promise<WatchPageSession>;
  onSnapshot: (snapshot: WatchPageSnapshot) => void;
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
      options.onSnapshot(await session.read());
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
