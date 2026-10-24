/**
 * `composition/watchPageBrowser.ts` の Playwright（Chromium）実装。
 *
 * このリポジトリで Chromium を動かして通っている統合テスト
 * (`tests/integration/vigilant-fiesta-play-loop.test.ts`) と同じく、素の
 * `playwright` を使う。`watchPageStatisticsSource` からは必要なときだけ
 * 動的 import するので、reader を無効にした環境では Playwright をロードしない。
 */

import { chromium } from "playwright";
import {
  isCapturableMediaSource,
  isInAdContainer,
  isVideoReady,
  type VideoState,
  waitForMeasurableVideo,
} from "../scripts/check-stream";
import {
  isAnyPlayerAdvertisementPlaying,
  isPlayerAdvertisement,
  isWatchPageReadable,
  type PictureMotion,
  startVideoPlayback,
  toDisplayedStatistics,
  type WatchPageBrowser,
  type WatchPageRawReading,
  waitForAdvertisementEnd,
} from "./watchPageBrowser";

const NAVIGATION_TIMEOUT_MS = 60_000;
/** ブラウザ起動の応答が無いと気付けないため、必ず上限を効かせる。 */
const LAUNCH_TIMEOUT_MS = 60_000;
/** 統計行が `-` から値に埋まるまでの待ち。超過しても読取自体は続行する。 */
const STATISTICS_READY_TIMEOUT_MS = 10_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/*
 * 配信映像の動きの測定（`measurePictureMotion`）。判定の根拠（動画の選別、
 * 広告の除外、ピクセルの比較のしきい値）は配信異常検知の権威である
 * `scripts/check-stream.ts` の unit test 済み関数 (`isCapturableMediaSource`,
 * `isInAdContainer`) を文字列化してページ側に注入する形で借りる。チェックス
 * クリプト自体は改変しない（issue #807 契約）。
 */
const MOTION_WINDOW_MS = 3_000;
/** 統計用ブラウザは 1600x900 で、全画面の 1/12 程度に縮めて比較する。 */
const MOTION_MAX_DIMENSION = 128;
/** この差を超えたピクセルは「変わった」と数える。 */
const MOTION_CHANNEL_TOLERANCE = 16;
/** 全ピクセルのうちこの割合を超えて変わったフレームだけを差分として数える。 */
const MOTION_MIN_CHANGED_RATIO = 0.001;
/** rAF が一切来ない（レンダラ停止）ときでも絶対に帰る上限。 */
const MOTION_EVALUATE_TIMEOUT_MS = MOTION_WINDOW_MS + 5_000;
/**
 * 測定の前段の `page.evaluate`（セレクタ注入・広告確認・`<video>` の状態読み）
 * に許す上限。レンダラが固まるとこれらも帰らず、`broadcastFreezeWatchdog` の
 * 1 周期が永久に塞がる。帰らなければ「測れなかった」に落として次の周期へ進む。
 */
const MOTION_PROBE_TIMEOUT_MS = 10_000;
/**
 * 測定の前に待つ広告の上限。`scripts/check-stream.ts` と同じく長めに待ってでも
 * 清潔な窓を取る: 統計用ブラウザはサインアウトのまま長く開いておくので中割り
 * 広告が繰り返され、待たずに測ると停止と広告を区別できず回復が走らない。
 */
const ADVERTISEMENT_WAIT_TIMEOUT_MS = 90_000;
/** 広告の終了を何ミリ秒ごとに確かめるか。 */
const ADVERTISEMENT_POLL_MS = 500;
/**
 * 窓を開く前に、計測できる `<video>` が戻るのを待つ上限。プレイヤーは
 * 中割り広告の明けや hls.js の復帰で要素を作り直す。作り直しの最中に窓を
 * 開くと空測定（= 判定不能）になり、`CompositeFreezePolicy` はそれを
 * 「連続静止の途切れ」として扱う。実際の停止中は hls.js が復帰を試み続けて
 * 要素の作り直しが重なるため、ここで待たないと回復のラングが上がらない。
 * `scripts/check-stream.ts` の `waitForMeasurableVideo` と同じ趣旨。
 */
const MEASURABLE_VIDEO_TIMEOUT_MS = 30_000;
/** 計測可能かの確認間隔。 */
const MEASURABLE_VIDEO_POLL_MS = 250;
/**
 * 作り直された要素が最初の一枚絵を出し切るまで待つ秒数。時計がこれだけ
 * 進むのを確かめてから窓を開く（`PLAYBACK_WARMUP_SECONDS` と同じ発想）。
 */
const MEASURABLE_VIDEO_ADVANCE_SECONDS = 1;

declare global {
  interface Window {
    /** `installVideoSelectors` が置く。全 `<video>` の再生を促す。 */
    __mmjStartPlayback?: () => void;
  }
}

/**
 * ページ側の動画選別ヘルパーと再生開始ヘルパーを置く。navigation で消えるの
 * で毎回入れ、置いたついでに全 `<video>` の再生を促す。再生していない要素は
 * `__mmjSelectCapturableVideo` に選ばれず、測定が永久に `unknown` になる。
 *
 * 文字列化して注入するので、ヘルパー同士の参照は注入後のページスコープの名前で
 * 解決される（`isAnyPlayerAdvertisement` は `isPlayerAdvertisement` を呼ぶ）。
 */
/**
 * ページ側の評価を上限つきで待つ。帰らなければ `fallback` を返す。
 * レンダラ停止中の `page.evaluate` は解決しないので、呼び出し側の周期を
 * 塞がないようにここで打ち切る。
 */
const withProbeTimeout = <T>(
  evaluate: Promise<T>,
  fallback: T,
  timeoutMs: number = MOTION_PROBE_TIMEOUT_MS,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = globalThis.setTimeout(resolve, timeoutMs, fallback);
  });
  return Promise.race([evaluate.catch(() => fallback), timeout]).finally(() => {
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
    }
  });
};

const installVideoSelectors = (page: import("playwright").Page) =>
  withProbeTimeout(
    page.evaluate(`
(() => {
  const isCapturable = ${isCapturableMediaSource.toString()};
  const isInAd = ${isInAdContainer.toString()};
  const isPlayerAdvertisement = ${isPlayerAdvertisement.toString()};
  const isAnyPlayerAdvertisement = ${isAnyPlayerAdvertisementPlaying.toString()};
  const startPlayback = ${startVideoPlayback.toString()};
  const origin = location.origin;
  const isSized = (v) => v.videoWidth > 0 && v.readyState >= 2;
  const inAdContainer = (v) => {
    let cur = v;
    while (cur && cur !== document.body) {
      if (isInAd(String(cur.className || "") + " " + String(cur.id || ""))) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  };
  window.__mmjSelectCapturableVideo = () => {
    const videos = Array.from(document.querySelectorAll("video"));
    const capturable = videos.filter(
      (v) => isCapturable(v.currentSrc || v.src || "", origin) && !inAdContainer(v),
    );
    return (
      capturable.find((v) => v.paused === false && isSized(v)) ??
      capturable.find(isSized) ??
      null
    );
  };
  window.__mmjIsAdvertisementPlaying = () =>
    isAnyPlayerAdvertisement(
      Array.from(document.querySelectorAll("video")).map((v) => ({
        source: v.currentSrc || v.src || "",
        playing: v.paused === false,
        sized: isSized(v),
        inAdContainer: inAdContainer(v),
      })),
      origin,
      isCapturable,
    );
  window.__mmjStartPlayback = () =>
    startPlayback(Array.from(document.querySelectorAll("video")));
  window.__mmjStartPlayback();
})()
`),
    undefined,
  );

/**
 * 1 窓の間、縮小した配信映像を rAF のたびに比較する。
 * `scripts/check-stream.ts` のサンプラーと同じ骨格の、全部画面バージョン
 * （ゲーム画面クリップの区別は不要）。
 *
 * 窓の開始時に計測できる `<video>` が無くても空測定で打ち切らない。プレイヤー
 * は要素を作り直すので、開始の一瞬だけ対象が消えることがある。待たずに
 * 打ち切るとその周期が判定不能になり、`CompositeFreezePolicy` が連続静止を
 * 数え直して回復が走らない。要素が入れ替わったらピクセル比較を切り、media
 * clock の前進は同じ要素の間の正の差分を足し上げる（作り直しで currentTime が
 * 巻き戻っても「放映中」の根拠を失わない）。
 */
const sampleMotionWindow = async ({
  durationMs,
  maxDimension,
  channelTolerance,
  minChangedRatio,
}: {
  durationMs: number;
  maxDimension: number;
  channelTolerance: number;
  minChangedRatio: number;
}): Promise<PictureMotion> => {
  let context: OffscreenCanvasRenderingContext2D | null = null;
  let width = 0;
  let height = 0;
  let previous: Uint8ClampedArray | null = null;
  let comparedFrames = 0;
  let changedFrames = 0;
  let tainted = false;
  let sawAdvertisement = false;
  let sampledVideo: HTMLVideoElement | null = null;
  let lastClock = 0;
  let clockAdvancedSeconds = 0;
  const start = performance.now();
  try {
    await new Promise<void>((resolve) => {
      const deadline = start + durationMs;
      const safety = setTimeout(resolve, durationMs + 10_000);
      const tick = () => {
        const now = performance.now();
        if (now >= deadline) {
          clearTimeout(safety);
          resolve();
          return;
        }
        if (window.__mmjIsAdvertisementPlaying?.()) {
          sawAdvertisement = true;
        }
        try {
          const video = window.__mmjSelectCapturableVideo?.() ?? null;
          // 再構築の途中で要素が消えうる。比較対象を落とさず待つ。
          if (video?.videoWidth && video.videoHeight) {
            if (video !== sampledVideo) {
              // 別の要素に切り替わる直前までに進んだ分を足し上げてから基準を
              // 切り替える。巻き戻る currentTime でも放映中の根拠を失わない
              // （作り直しのたびに最後の端数を捨てると、頻繁な再構築で
              // clockAdvancedSeconds が 1 秒に届かず放映外と誤判定される）。
              if (sampledVideo !== null) {
                const previousAdvanced = sampledVideo.currentTime - lastClock;
                if (previousAdvanced > 0) {
                  clockAdvancedSeconds += previousAdvanced;
                }
              }
              // 別の要素のタイムラインなので時計の基準は切り替える。絵の比較は
              // 寸法が同じなら引き継ぐ: 再構築のたびに比較対象を捨てると、頻繁
              // な再構築で comparedFrames が 0 になり、本物の停止が判定不能
              // (`unknown`) として捨てられる。
              sampledVideo = video;
              lastClock = video.currentTime;
              const nextScale = Math.min(
                1,
                maxDimension / Math.max(video.videoWidth, video.videoHeight),
              );
              const nextWidth = Math.max(
                1,
                Math.round(video.videoWidth * nextScale),
              );
              const nextHeight = Math.max(
                1,
                Math.round(video.videoHeight * nextScale),
              );
              if (nextWidth !== width || nextHeight !== height) {
                previous = null;
                context = null;
                width = 0;
                height = 0;
              }
            } else {
              const advanced = video.currentTime - lastClock;
              if (advanced > 0) {
                clockAdvancedSeconds += advanced;
              }
              lastClock = video.currentTime;
            }
            if (!context) {
              const scale = Math.min(
                1,
                maxDimension / Math.max(video.videoWidth, video.videoHeight),
              );
              width = Math.max(1, Math.round(video.videoWidth * scale));
              height = Math.max(1, Math.round(video.videoHeight * scale));
              const canvas = new OffscreenCanvas(width, height);
              context = canvas.getContext("2d", { willReadFrequently: true });
            }
            if (context) {
              context.drawImage(video, 0, 0, width, height);
              const current = context.getImageData(0, 0, width, height).data;
              if (previous) {
                let changed = 0;
                const total = width * height;
                for (let p = 0; p < total; p++) {
                  const i = p * 4;
                  const redDiff = Math.abs(
                    (previous[i] ?? 0) - (current[i] ?? 0),
                  );
                  const greenDiff = Math.abs(
                    (previous[i + 1] ?? 0) - (current[i + 1] ?? 0),
                  );
                  const blueDiff = Math.abs(
                    (previous[i + 2] ?? 0) - (current[i + 2] ?? 0),
                  );
                  if (
                    redDiff > channelTolerance ||
                    greenDiff > channelTolerance ||
                    blueDiff > channelTolerance
                  ) {
                    changed += 1;
                  }
                }
                comparedFrames += 1;
                if (changed / total > minChangedRatio) {
                  changedFrames += 1;
                }
              }
              previous = current;
            }
          }
        } catch {
          // このコールバック内の例外は await された promise を reject しない。
          tainted = true;
          clearTimeout(safety);
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } catch {
    return {
      comparedFrames,
      changedFrames,
      windowMs: performance.now() - start,
      tainted: true,
      sawAdvertisement,
      clockAdvancedSeconds,
    };
  }
  return {
    comparedFrames,
    changedFrames,
    windowMs: performance.now() - start,
    tainted,
    sawAdvertisement,
    clockAdvancedSeconds,
  };
};

/**
 * 窓を開く前に対象 `<video>` の状態を読む。作り直しで paused に戻った要素は
 * その場で再生を促す（再生していない要素は選別対象にならない）。
 */
const readSelectedVideoState = (): VideoState => {
  const video = window.__mmjSelectCapturableVideo?.() ?? null;
  if (!video) {
    return {
      found: false,
      videoWidth: 0,
      readyState: 0,
      paused: true,
      currentTime: 0,
      decodedAudioBytes: 0,
    };
  }
  if (video.paused) {
    window.__mmjStartPlayback?.();
  }
  return {
    found: true,
    videoWidth: video.videoWidth,
    readyState: video.readyState,
    paused: video.paused,
    currentTime: video.currentTime,
    decodedAudioBytes: 0,
  };
};

/**
 * 統計行の表示テキストを読む。クラス名にはビルド用ハッシュが付くため部分一致で探す。
 * 値が `-` のまま（JS がまだ埋めていない / ページに無い）場合はそのまま文字列を返す。
 */
const readDisplayedValues = (): WatchPageRawReading => {
  const readItem = (className: string): string | null => {
    const item = document.querySelector(`[class*="${className}"]`);
    const inner = item?.querySelector("[class*='inner-content']");
    const text = inner?.textContent?.trim();
    return text !== undefined && text.length > 0 ? text : null;
  };
  return {
    statistics: {
      viewers: readItem("watch-count-item"),
      comments: readItem("comment-count-item"),
      nicoadPoints: readItem("nicoad-count-item"),
      giftPoints: readItem("gift-count-item"),
    },
    hasStatisticsRow:
      document.querySelector('[class*="watch-count-item"]') !== null,
  };
};

/** 統計行に値が入った（`data-blank` が false になった）のを待つ。 */
const waitForStatistics = (page: import("playwright").Page) =>
  page
    .waitForFunction(
      () => {
        const item = document.querySelector('[class*="watch-count-item"]');
        return (
          item?.querySelector("button, span")?.getAttribute("data-blank") ===
          "false"
        );
      },
      undefined,
      { timeout: STATISTICS_READY_TIMEOUT_MS },
    )
    .catch(() => {
      // 値が埋まらないまま（`-`）でも採取自体は続行する。次の採取で最新になる。
    });

export const createChromiumWatchPageBrowser =
  async (): Promise<WatchPageBrowser> => {
    // 各段階をログに残す。ブラウザの起動や navigation が応答しないで
    // 止まったときに、どこで止まったかが特定できるようにするため。
    console.log("[INFO] launching chromium for the niconama watch page...");
    const browser = await chromium.launch({
      headless: true,
      timeout: LAUNCH_TIMEOUT_MS,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        // 配信映像の動きを測るには `<video>` が再生している必要がある。
        // unmuted 自動再生を許して、映像が止まっていないかを見られるようにする。
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "ja-JP",
      viewport: { width: 1600, height: 900 },
    });
    const page = await context.newPage();
    console.log("[INFO] chromium launched for the niconama watch page");
    let lastReadLog: string | undefined;
    /** 過去に計測可能な `<video>` を観測したことがあるか。レンダラ固着検知に使う。 */
    let hasEverBeenMeasurable = false;

    return {
      open: async (watchPageUrl) => {
        console.log(`[INFO] opening the watch page: ${watchPageUrl}`);
        const response = await page.goto(watchPageUrl, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
        console.log(
          `[INFO] watch page opened (status=${response?.status() ?? "unknown"}, url=${page.url()})`,
        );
        await waitForStatistics(page);
        // 統計行が描画された時点でプレイヤーは存在する。ここで再生を促して
        // おかないと、headless では `<video>` が paused のままになり、以降の
        // 映像の動きの測定がずっと `unknown` になる（回復が一度も走らない）。
        await installVideoSelectors(page);
        console.log("[INFO] watch page statistics settled");
      },
      read: async () => {
        const raw = await withProbeTimeout(page.evaluate(readDisplayedValues), {
          statistics: {
            viewers: null,
            comments: null,
            nicoadPoints: null,
            giftPoints: null,
          },
          hasStatisticsRow: false,
        } satisfies WatchPageRawReading);
        // 採取は短い周期で回るので、同じ内容ならログを出さない。
        const readLog = JSON.stringify(raw.statistics);
        if (readLog !== lastReadLog) {
          lastReadLog = readLog;
          console.log(`[INFO] read the watch page (statistics=${readLog})`);
        }
        if (!isWatchPageReadable(raw)) {
          // 配信ページを見ていない（空 / エラーページ / JS 実行前）。
          // ここを throw にしておくと source 側が直前の値を保持し、
          // CI ログに原因が出る。黙って値を消さない。
          throw new Error(
            `the niconama watch page has no statistics row (url=${page.url()}, title=${JSON.stringify(
              await page.title().catch(() => ""),
            )}, statistics=${readLog})`,
          );
        }
        return toDisplayedStatistics(raw);
      },
      // ページ実体が生きているかのみを報告する。`open` に失敗した実体は
      // source が破棄するので、ここで未オープンを区別する必要はない。
      isAlive: () => browser.isConnected() && !page.isClosed(),
      measurePictureMotion: async () => {
        await installVideoSelectors(page);
        // 中割り広告で `<video>` が止まると窓は静止に見え、判定不能として破棄
        // される。統計用ブラウザはサインアウトのまま長く開いておくので中割りが
        // 繰り返され、待たずに測ると清潔な窓がほとんど取れず本物の停止が回復に
        // 達しない。健康チェック (check-stream.ts) と同じく、測定前に流れる広告
        // が終わるのを待つ。上限まで待っても流れていたら測定を続行する（サン
        // プラーが sawAdvertisement を立て、その窓は判定不能として破棄される）。
        const advertisementEnded = await waitForAdvertisementEnd({
          isAdvertisementPlaying: () =>
            withProbeTimeout(
              page.evaluate(
                () => window.__mmjIsAdvertisementPlaying?.() ?? false,
              ),
              false,
            ),
          timeoutMs: ADVERTISEMENT_WAIT_TIMEOUT_MS,
          pollMs: ADVERTISEMENT_POLL_MS,
          sleep: (ms) =>
            new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms)),
        });
        if (!advertisementEnded) {
          console.log(
            "[INFO] an advertisement was still playing after the wait; measuring anyway",
          );
        }
        // プレイヤーは広告の明けや hls.js の復帰で `<video>` を作り直す。作り
        // 直しの最中に窓を開くと空測定になり、停止が続いていても連続静止が
        // 途切れる。計測できる要素が戻り、時計が少し進むまで待ってから測る。
        const measurable = await waitForMeasurableVideo({
          probe: () =>
            withProbeTimeout(page.evaluate(readSelectedVideoState), {
              found: false,
              videoWidth: 0,
              readyState: 0,
              paused: true,
              currentTime: 0,
              decodedAudioBytes: 0,
            } satisfies VideoState),
          timeoutMs: MEASURABLE_VIDEO_TIMEOUT_MS,
          pollMs: MEASURABLE_VIDEO_POLL_MS,
          sleep: (ms) =>
            new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms)),
          requireAdvanceSeconds: MEASURABLE_VIDEO_ADVANCE_SECONDS,
        });
        const wasMeasurable = isVideoReady(measurable);
        if (wasMeasurable) {
          hasEverBeenMeasurable = true;
        }
        if (!wasMeasurable) {
          console.log(
            "[INFO] the watch page video was not measurable; measuring the window anyway",
          );
        }
        // レンダラが固まっていると evaluate が帰らない可能性がある。待ちの
        // 上限を置いて、帰らなければ「測れなかった」に落とす。
        //
        // ただし過去に計測可能な `<video>` を観測していた（映像が流れていた）のに
        // 今回の測定がタイムアウトした場合、レンダラの固まり（合成出力の停止）が
        // 疑われる。このとき「判定不能」ではなく「静止」を返すことで
        // `CompositeFreezePolicy` が連続静止として検知し、回復を走らせられるように
        // する（外部の健康チェックは毎時検知するが、内部の watchdog が検知できないと
        // 回復が走らない issue #982 対策）。
        //
        // page.evaluate がエラーで reject することもある（ページクラッシュ等）。
        // その場合も timeout と同じ fallback を返すように catch する。
        const timeoutPromise = new Promise<PictureMotion>((resolve) => {
          globalThis.setTimeout(() => {
            if (hasEverBeenMeasurable) {
              // 過去に計測可能だったなら、今回のタイムアウトはレンダラ固着＝静止とみなす
              resolve({
                comparedFrames: 1,
                changedFrames: 0,
                windowMs: MOTION_WINDOW_MS,
                tainted: false,
                sawAdvertisement: false,
                clockAdvancedSeconds: MEASURABLE_VIDEO_ADVANCE_SECONDS,
              });
            } else {
              // まだ一度も計測可能になっていない（初回の立ち上げ遅れ等）なら判定不能
              resolve({
                comparedFrames: 0,
                changedFrames: 0,
                windowMs: 0,
                tainted: true,
                sawAdvertisement: false,
                clockAdvancedSeconds: 0,
              });
            }
          }, MOTION_EVALUATE_TIMEOUT_MS);
        });
        try {
          const motion = await Promise.race([
            page.evaluate(sampleMotionWindow, {
              durationMs: MOTION_WINDOW_MS,
              maxDimension: MOTION_MAX_DIMENSION,
              channelTolerance: MOTION_CHANNEL_TOLERANCE,
              minChangedRatio: MOTION_MIN_CHANGED_RATIO,
            }),
            timeoutPromise,
          ]);
          return motion;
        } catch {
          if (hasEverBeenMeasurable) {
            // 過去に計測可能だったなら、例外もレンダラ固着＝静止とみなす
            // tainted: false にして judgePictureMotion が "still" と判定できるようにする
            // (tainted: true だと判定不能になり streak が伸びない)
            return {
              comparedFrames: 1,
              changedFrames: 0,
              windowMs: MOTION_WINDOW_MS,
              tainted: false,
              sawAdvertisement: false,
              clockAdvancedSeconds: MEASURABLE_VIDEO_ADVANCE_SECONDS,
            };
          }
          // まだ一度も計測可能になっていないなら判定不能
          return {
            comparedFrames: 0,
            changedFrames: 0,
            windowMs: 0,
            tainted: true,
            sawAdvertisement: false,
            clockAdvancedSeconds: 0,
          };
        }
      },
      discard: async () => {
        try {
          await browser.close();
        } catch {
          /* ignore */
        }
      },
    };
  };
