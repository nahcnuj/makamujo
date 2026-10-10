/**
 * 配信ページを描画したブラウザ実体の契約。統計行を読む責務だけを持つ。
 *
 * Playwright の実装は `composition/chromiumWatchPageBrowser.ts` にある。採取周期
 * （何秒ごとに読むか）や作り直しの判定は `composition/watchPageStatisticsSource.ts`
 * 側の責務で、ここでは「いま画面に表示されている値を 1 回読む」だけを行う。
 */

import {
  type DisplayedStatistics,
  type DisplayedStatisticsTexts,
  parseDisplayedStatistics,
} from "../lib/domain/broadcasting/watchPageStatistics";

/** 差し替え口。`composition/chromiumWatchPageBrowser.ts` が実装。 */
export type WatchPageBrowser = {
  /** 配信ページを開き、統計行が描画されるまで待つ。 */
  open: (watchPageUrl: string) => Promise<void>;
  /** いま画面に表示されている値を採取する。 */
  read: () => Promise<DisplayedStatistics>;
  /**
   * ブラウザ実体（プロセス / ページ）が生きており、`open` が済んでいるか。
   * 統計行があるか等のページの表示状態とは無関係で、source が作り直すべきとき
   * （未オープン / 実体が落ちた）だけ false。
   */
  isAlive: () => boolean;
  /** ブラウザ実体を捨てる。捨てたあとは再利用してはならない。 */
  discard: () => Promise<void>;
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

/**
 * 本番で読む配信ページ。**固定値**。ここを変える必要があるなら
 * 環境変数 `NICONAMA_WATCH_PAGE_URL`（テスト専用の差し替え口）を使う。
 */
export const DEFAULT_NICONAMA_WATCH_PAGE_URL =
  "https://live.nicovideo.jp/watch/user/14171889";

/** ページが更新する仕組みが 30〜60 秒粒度なので、デフォルトは 30 秒。 */
export const WATCH_PAGE_READ_INTERVAL_MS = 30_000;
