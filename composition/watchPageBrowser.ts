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
   * 配信映像が 1 窓の間にどれだけ動いたかを測る。省略可: 実装が測れない場合
   * （古い差し替え実装など）はメソッドごと省いてよく、呼び出し側
   * （`watchPageStatisticsSource`）はその場合測定不可として扱う。
   */
  measurePictureMotion?: () => Promise<PictureMotion>;
  /**
   * ブラウザ実体（プロセス / ページ）が生きているか。統計行があるか等のページの
   * 表示状態とは無関係で、source が作り直すべきとき（実体が落ちた）だけ false。
   * `open` に失敗した実体は source 側が破棄する。
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

/** 配信ページの `<video>` が 1 窓の間 提示した画面の動きの測定。 */
export interface PictureMotion {
  /** 隣接フレームの比較回数。 */
  comparedFrames: number;
  /** 差があった隣接フレームの組の数。 */
  changedFrames: number;
  /** サンプラーが動いた実時間（ミリ秒）。 */
  windowMs: number;
  /** 描画に失敗して（tainted canvas）比較ができなかった。 */
  tainted: boolean;
  /** 窓の間に広告が流れた。測れた動きは番組のものではない。 */
  sawAdvertisement: boolean;
}

/**
 * この changed fps を上回らない窓を配信画面「静止」とみなす。
 *
 * `scripts/check-stream.ts` の `VIDEO_MIN_FPS`（24: 下回ったら映像停止と
 * 判定される）と同じ値で保つ。低解像（1〜21 changed fps）に落ち込む
 * 慢性的な劣化は、しきい値 2 では「動き」に判別されて回復が打てなかった
 * ため、検知の権威が映像停止と呼ぶ帯域をそのまま回復の対象にする。
 */
export const PICTURE_STILL_FPS_THRESHOLD = 24;

/**
 * サンプラー自身の観測レート（compared fps）に対するしきい値の下限倍率。
 *
 * changed fps はサンプラーの fps を超えられないため、サンプラーが遅い
 * 窓では 24 を基準にすると健康な配信でも静止に見える。サンプラーが
 * `PICTURE_STILL_FPS_THRESHOLD` 未満のときは、その半分の fps を下回る
 * 変化だけを静止と数える（凍結はどの倍率でも静止のまま）。
 */
export const PICTURE_STILL_SAMPLER_FRACTION = 0.5;

/**
 * 測定を静止 / 動き / 判定不能に分ける。
 *
 * 判定不能は `undefined`: 広告が流れた窓・tainted canvas・比較対象が少なすぎる
 * 窓は、配信の不調でも正常でもないので観測から外れる（誤検知の防止）。
 * 「配信が静止している」は changed fps が（サンプラーの観測レートで絞った）
 * しきい値を下回ること。
 */
export const judgePictureMotion = (
  motion: PictureMotion,
): "still" | "moving" | undefined => {
  if (motion.tainted || motion.sawAdvertisement) {
    return undefined;
  }
  const windowSeconds = motion.windowMs / 1000;
  if (windowSeconds < 1 || motion.comparedFrames < 5) {
    return undefined;
  }
  const samplerFps = motion.comparedFrames / windowSeconds;
  const changedFps = motion.changedFrames / windowSeconds;
  const stillThreshold = Math.min(
    PICTURE_STILL_FPS_THRESHOLD,
    samplerFps * PICTURE_STILL_SAMPLER_FRACTION,
  );
  return changedFps <= stillThreshold ? "still" : "moving";
};
