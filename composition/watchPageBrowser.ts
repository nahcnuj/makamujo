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

export interface AdvertisementWaitOptions {
  /** True while a cross-origin (advertisement) video is actively playing. */
  isAdvertisementPlaying: () => Promise<boolean>;
  /** Give up after this long; the caller decides whether to measure anyway. */
  timeoutMs: number;
  /** Gap between two probes. */
  pollMs: number;
  /** Injectable so tests do not wait in real time. */
  sleep: (ms: number) => Promise<void>;
  /** Injectable clock; defaults to wall-clock milliseconds. */
  now?: () => number;
}

/**
 * Poll until no advertisement is playing, or the timeout expires.
 *
 * A signed-out viewer gets a pre-roll on every load and mid-rolls while
 * watching; the live `<video>` is frozen for the whole advertisement, so a
 * window sampled during one measures a still picture and is discarded as
 * unmeasurable (`judgePictureMotion` returns `undefined`). The statistics
 * browser keeps its page open across many cycles, so recurring mid-rolls leave
 * almost no clean window and a genuine composite freeze never accumulates the
 * consecutive `still` cycles needed to recover — the scheduled health check
 * then raises the issue. Waiting for the current advertisement to end before
 * sampling (the same approach `scripts/check-stream.ts` uses) gives the
 * watchdog a clean window to judge.
 *
 * Returns `true` when the wait observed no advertisement (a clean window can be
 * sampled), `false` when one was still playing at the deadline.
 */
export const waitForAdvertisementEnd = async ({
  isAdvertisementPlaying,
  timeoutMs,
  pollMs,
  sleep,
  now = () => Date.now(),
}: AdvertisementWaitOptions): Promise<boolean> => {
  const deadline = now() + timeoutMs;
  for (;;) {
    if (!(await isAdvertisementPlaying())) {
      return true;
    }
    if (now() >= deadline) {
      return false;
    }
    await sleep(pollMs);
  }
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
