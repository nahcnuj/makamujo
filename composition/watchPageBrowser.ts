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

/** この changed fps 未満で配信画面を「静止」とみなす。 */
export const PICTURE_STILL_FPS_THRESHOLD = 2;

/**
 * 測定を静止 / 動き / 判定不能に分ける。
 *
 * 判定不能は `undefined`: 広告が流れた窓・tainted canvas・比較対象が少なすぎる
 * 窓は、配信の不調でも正常でもないので観測から外れる（誤検知の防止）。
 * 「配信が静止している」は changed fps がしきい値を下回ること。
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
  const changedFps = motion.changedFrames / windowSeconds;
  return changedFps < PICTURE_STILL_FPS_THRESHOLD ? "still" : "moving";
};

/** 映像の選別に必要な `<video>` の最小限。DOM 無しでテストできる。 */
export interface MeasurableVideoLike {
  paused: boolean;
  videoWidth: number;
  readyState: number;
}

/**
 * 採取可能な `<video>` の中から測るものを 1 つ選ぶ。
 *
 * 選択順は配信異常検知の権威 `scripts/check-stream.ts` と同じ: 再生中で
 * サイズのある要素を優先し、無ければサイズだけある要素に降りる。
 *
 * このフォールバックは合成出力の停止検知に必須。合成出力（XSHM → x264）が
 * 固まると配信の HLS が途切れ、視聴ページの `<video>` が一時停止 / バッファ
 * リング状態になりうる。再生中だけを選ぶと要素が取れず測定が空になり、
 * 判定が `unknown` になって `CompositeFreezePolicy` の静止 streak が毎周期
 * リセットされるため、回復ラングが永久に打たれない。一時停止した要素でも
 * 最後のフレームは描画でき、変わらない絵は正しく「静止」と測れる。
 *
 * `scripts/check-stream.ts` 自体は改変しない（owner 契約 #807）。ここで
 * 純関数として持つことで、unit test とページ注入の双方が同じ順序を使う。
 */
export const selectMeasurableVideo = <T extends MeasurableVideoLike>(
  capturable: readonly T[],
): T | undefined => {
  const isActive = (video: T): boolean =>
    video.videoWidth > 0 && video.readyState >= 2 && !video.paused;
  const isSized = (video: T): boolean =>
    video.videoWidth > 0 && video.readyState >= 2;
  return capturable.find(isActive) ?? capturable.find(isSized);
};

/** ページ側の再生開始に必要な `<video>` の最小限。 */
export interface PlayableVideo {
  muted: boolean;
  play: () => unknown;
}

/**
 * ページ上の動画をすべてミュートして再生開始する。
 *
 * 統計用ブラウザは headless で動く。muted 自動再生は既定で許されるが、
 * unmuted 再生は自動再生ポリシーで拒否されうる。再生していない `<video>` は
 * `measurePictureMotion` のサンプラーが比較対象に選べないため、配信が本当に
 * 固まっていても観測は `unknown` のままになり、回復が一度も走らない。
 * 起動フラグと併せて全要素を再生のきっかけにする（`play()` の失敗は無視する:
 * サンプラーが計測前に要素の状態を再確認し、次の窓で再試行される）。
 *
 * ページへ文字列化して注入するため、外部参照を持たない自己完結な関数にする。
 */
export const startVideoPlayback = (videos: Iterable<PlayableVideo>): void => {
  for (const video of videos) {
    try {
      video.muted = true;
      void Promise.resolve(video.play()).catch(() => undefined);
    } catch {
      // 要素の再構築中でも次の計測で再試行される。
    }
  }
};
