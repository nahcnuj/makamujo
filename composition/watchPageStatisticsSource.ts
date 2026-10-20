/**
 * 統計の供給源。index.ts からブラウザの配線とログ制御を追い出す。
 *
 * ページは一度だけ開き、以降は開いたまま統計行の表示テキストを読み直す
 * （ページ自身が WebSocket で更新するため）。採取周期ごとに再読み込みはしない。
 * 読み取りに失敗しても開いたページは開き直したり閉じたりしない（普通に視聴
 * するときと同じ）。作り直すのは `isAlive()` が false（実体が落ちた）か、
 * `open` に失敗したときだけで、公開中の値は失敗中も直前のものを保つ（勝手
 * には空にしない）。
 *
 * 映像の動きの測定（`measurePictureMotion`）は「測定のためにページを作り
 * 直さない」のと同じ方針だが、**測れないまま続く**場合に限っては例外を置く:
 * 生きてはいるが測れないページ（プレイヤーが paused のまま、エラーページ、
 * ナビゲーション後）が永久に残ると、配信画面の停止を測る側
 * （`broadcastFreezeWatchdog`）が毎周期を測定不能として回復を一度も打てない
 * ままになる。外からの健康チェック（`scripts/check-stream.ts`）は毎回
 * 新しいページで測るので検知を続け、うち回復だけが止まる。そこで測定が
 * `PICTURE_MOTION_PAGE_RECREATE_AFTER_FAILURES` 回連続で失敗したときに限り、
 * そのページを捨てて次の統計の採取に開き直させる。
 *
 * 差し替え口は `createBrowser`（ブラウザ実体そのもの）であって URL ではない。
 * テストは `NICONAMA_WATCH_PAGE_DISABLED=1` で全体を無効化するか、
 * `createBrowser` を差し替えてローカルページを読ませることができる。
 */

import type { DisplayedStatistics } from "../lib/domain/broadcasting/watchPageStatistics";
import type { PictureMotion } from "./watchPageBrowser";
import {
  DEFAULT_NICONAMA_WATCH_PAGE_URL,
  WATCH_PAGE_READ_INTERVAL_MS,
  type WatchPageBrowser,
} from "./watchPageBrowser";

export type WatchPageStatisticsSourceOptions = {
  /** 差し替え口。省略時は Chromium で実ページを読む。 */
  createBrowser?: () => Promise<WatchPageBrowser>;
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
  /** 1 回だけ採取する。 */
  readOnce: () => Promise<void>;
  /**
   * 開いたままの配信ページで、映像の動きを 1 窓だけ測る。
   * 測定できない（無効化されている、ページが開けていない、実装が測れない、
   * 測定中に失敗した）ときは `undefined` を返して断念する。測定のために
   * ページを開き直したりはしない: 開いたままのページで動くときだけ測れる。
   * ただし測れないことが
   * `PICTURE_MOTION_PAGE_RECREATE_AFTER_FAILURES` 回連続したら、そのページは
   * 測定に向かないものとして捨て、次の統計の採取に開き直させる。
   */
  measurePictureMotion: () => Promise<PictureMotion | undefined>;
  stop: () => Promise<void>;
};

/**
 * 映像の動きの測定がこの回数連続して失敗したら、開いたままのページを捨てる。
 *
 * 1 回だけの失敗（ナビゲーションの隙間、広告の切り替わり）は通常視聴でも
 * 起きるうえ、次の周期で測れ直る。連続する失敗は「生きてはいるが測れない
 * ページ」を指すので、統計の採取に開き直させたほうがよい。この回数は
 * watchdog の観測周期（既定 60 秒）で数え、統計の採取周期
 * （既定 30 秒）より長めに取って、1 度の失敗で作り直さないようにする。
 */
export const PICTURE_MOTION_PAGE_RECREATE_AFTER_FAILURES = 3;

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
    return {
      ready: Promise.resolve(),
      readOnce: async () => {},
      measurePictureMotion: async () => undefined,
      stop: async () => {},
    };
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
  let reading = false;
  let browser: WatchPageBrowser | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pictureMotionFailures = 0;

  const createChromiumBrowser = async (): Promise<WatchPageBrowser> =>
    options.createBrowser
      ? await options.createBrowser()
      : // Playwright を含む実装だけ動的 import する。差し替えが無いテストでは
        // Chromium 側を一切ロードしない。
        await (
          await import("./chromiumWatchPageBrowser")
        ).createChromiumWatchPageBrowser();

  /**
   * 開いたままのブラウザを返す。`isAlive()` が false（実体が落ちた）ときだけ
   * 破棄して作り直し、ページを開き直す。ページが読めないだけの失敗では開いた
   * まま維持する。`open` に失敗した実体は未オープンのまま残さず破棄する。
   */
  const ensureAliveBrowser = async (): Promise<WatchPageBrowser> => {
    if (browser?.isAlive()) {
      return browser;
    }
    await browser?.discard();
    const created = await createChromiumBrowser();
    browser = created;
    try {
      await created.open(watchPageUrl);
    } catch (error) {
      await created.discard();
      browser = undefined;
      throw error;
    }
    return created;
  };

  const readOnce = async (): Promise<void> => {
    if (reading || stopped) {
      return;
    }
    reading = true;
    try {
      const current = await ensureAliveBrowser();
      options.onStatistics(await current.read());
    } catch (error) {
      // ページが読めないだけの失敗では開いたページはそのまま使う。普通に視聴
      // するときにブラウザを開いたり閉じたりしないのと同じ理屈。実体が落ちた
      // 場合や `open` に失敗した場合は ensureAliveBrowser が破棄するので、
      // 次の採取で作り直される。
      reportFailure(error);
    } finally {
      reading = false;
    }
  };

  const run = async () => {
    try {
      log.log(`[INFO] watch page statistics source started: ${watchPageUrl}`);
      await readOnce();
      if (!stopped) {
        timer = setInterval(() => {
          void readOnce();
        }, readIntervalMs);
      }
    } catch (error) {
      log.error(
        "[ERROR] failed to start the watch page statistics source:",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
  };

  /**
   * 測定できない周期を数え、連続が続けば開いたままのページを捨てる。
   * 捨てた分は次の統計の採取に開き直させる（ここで開き直さない:
   * ページを作る責務は統計の採取のままだ）。
   */
  const giveUpOnUnmeasurablePage = async (
    current: WatchPageBrowser,
  ): Promise<undefined> => {
    pictureMotionFailures += 1;
    if (pictureMotionFailures < PICTURE_MOTION_PAGE_RECREATE_AFTER_FAILURES) {
      return undefined;
    }
    pictureMotionFailures = 0;
    // 測定中に別の周期がすでに捨てていたら何もしない。
    if (browser !== current) {
      return undefined;
    }
    browser = undefined;
    log.warn(
      `[WARN] dropping the watch page after ${PICTURE_MOTION_PAGE_RECREATE_AFTER_FAILURES} consecutive unmeasurable picture motion cycles; the next statistics read reopens it`,
    );
    try {
      await current.discard();
    } catch {
      // 実体がすでに落ちているなら、次の採取が作り直す。
    }
    return undefined;
  };

  return {
    ready: run(),
    readOnce,
    measurePictureMotion: async (): Promise<PictureMotion | undefined> => {
      if (disabled || stopped) {
        return undefined;
      }
      const current = browser;
      // 測定のために実体やページを作り直さない。統計の採取が作ってくれる
      // 開いたままのページがあるときにだけ機会良く測れる。
      if (current === undefined || !current.isAlive()) {
        return undefined;
      }
      let measured: PictureMotion | undefined;
      try {
        measured = await current.measurePictureMotion?.();
      } catch {
        // ナビゲーション中などで失敗するだけなら測定不可として扱う。
        reportFailure(new Error("failed to measure the picture motion"));
        measured = undefined;
      }
      if (measured !== undefined) {
        pictureMotionFailures = 0;
        return measured;
      }
      return await giveUpOnUnmeasurablePage(current);
    },
    stop: async () => {
      stopped = true;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      const current = browser;
      browser = undefined;
      await current?.discard();
    },
  };
};
