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
  /**
   * 窓の間に対象 `<video>` の media clock（`currentTime`）が進んだ秒数。
   * 配信が放映中なら `0` より大きい。番組が終わって一枚絵が提示されている /
   * `<video>` が無い / paused のままなら `0`。
   */
  clockAdvancedSeconds: number;
}

/** この changed fps 未満で配信画面を「静止」とみなす。 */
export const PICTURE_STILL_FPS_THRESHOLD = 24;

/**
 * この秒数より media clock が進んでいれば「放映中」とみなす。判定は
 * `clockAdvancedSeconds > CLOCK_ADVANCE_MIN_SECONDS`（厳密に超える）。
 * media clock は hls.js がセグメントを再生している限り進むので、合成出力が
 * 固まっていても放映中と分かる。
 */
export const CLOCK_ADVANCE_MIN_SECONDS = 1;

/**
 * 測定から「番組が放映中か」を導く。
 *
 * 放映中の根拠をわんコメの `POST /api/meta` が張ったセッション
 * （`streamState`）にすると、cron の再起動直後やわんコメの切断時に毎周期が
 * 放映外とみなされ、`broadcastFreezeWatchdog` が測定すら行わず本物の合成出力
 * の停止を放置する（issue #929/#933: 音声と media clock は進み続け、外からの
 * 健康チェックだけが停止を繰り返し検知していた）。
 *
 * そこで放映中の根拠を、監視対象そのものである配信ページの `<video>` の
 * media clock の前進に置く。番組が終わって一枚絵になると clock は進まないので、
 * 放映外の静止は回復の対象にならない。
 *
 * `undefined`（測定不能・広告・tainted）は放映中か判断できないため
 * `undefined` を返し、呼び出し側は `unknown` として扱う。
 */
export const isOnAirFromClock = (
  motion: PictureMotion | undefined,
): boolean | undefined => {
  if (motion === undefined) {
    return undefined;
  }
  if (motion.clockAdvancedSeconds > CLOCK_ADVANCE_MIN_SECONDS) {
    return true;
  }
  // A totally frozen picture (no changed frames at all) counts as on-air even
  // when the media clock stopped advancing (e.g. the HLS stalled behind the
  // freeze): otherwise the recovery streak never accumulates for exactly the
  // freezes that need it. A picture with any motion is still gated by the
  // clock so legitimate still screens stay excluded.
  if (motion.comparedFrames > 0 && motion.changedFrames === 0) {
    return true;
  }
  return false;
};

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

/** 広告かどうかの判定に要る、ページ上の 1 つの `<video>` の状態。 */
export interface WatchPageVideoState {
  /** `currentSrc`（空なら `src`）。 */
  source: string;
  /** 再生中（`paused === false`）。 */
  playing: boolean;
  /** 描画できる大きさがある（`videoWidth > 0 && readyState >= 2`）。 */
  sized: boolean;
  /** 広告面（`___ad-sticky-video___` 等）の中にある。 */
  inAdContainer: boolean;
}

/**
 * この `<video>` が「番組のプレイヤーを占拠している広告」か。
 *
 * 放映中かどうかの判定に効くのは、**番組のプレイヤーを奪って配信映像を
 * 止める**広告だけ。ニコニコの配信ページはプレイヤーの外側にも
 * `___ad-sticky-video___` の広告面を常設し、そこでは広告動画（同一オリジンの
 * `blob:` と `gcdn.2mdn.net` などのクロスオリジン）が **ページを開いている間
 * ずっと** 再生され続ける（2026-10-20 に実測: 95 秒以上連続で再生）。
 *
 * これを広告と数えると、統計用ブラウザの測定は毎窓 `sawAdvertisement` になり、
 * `judgePictureMotion` がすべての窓を判定不能として捨てる。ストリークは永久に
 * 伸びず、合成出力が固まっていても回復ラングは一度も走らない。測定の前の
 * `waitForAdvertisementEnd` も、終わらない広告を上限（90 秒）まで待ってから
 * 同じ窓を捨てるので、観測自体が 90 秒周期に落ちる。外からの健康チェックだけが
 * 停止を検知し続けた（issue #946）。
 *
 * 広告面の中にあるものは番組を止めないので数えない。クロスオリジンという
 * だけでは足りない（常設広告もクロスオリジン）。プリロール / 中割り広告は
 * プレイヤー側に差し込まれ広告面の外に出るので、従来どおり広告として扱う。
 */
export const isPlayerAdvertisement = (
  video: WatchPageVideoState,
  origin: string,
  isCapturable: (source: string, origin: string) => boolean,
): boolean =>
  video.playing &&
  video.sized &&
  !video.inAdContainer &&
  !isCapturable(video.source, origin);

/** ページ上の動画のうち 1 つでもプレイヤーを占拠する広告が再生中か。 */
export const isAnyPlayerAdvertisementPlaying = (
  videos: Iterable<WatchPageVideoState>,
  origin: string,
  isCapturable: (source: string, origin: string) => boolean,
): boolean => {
  for (const video of videos) {
    if (isPlayerAdvertisement(video, origin, isCapturable)) {
      return true;
    }
  }
  return false;
};

export interface AdvertisementWaitOptions {
  /** True while an advertisement occupying the program player is playing. */
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
