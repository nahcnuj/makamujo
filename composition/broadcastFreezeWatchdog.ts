/**
 * 「配信画面が静止し続けている」状態からの回復を配線する。
 *
 * ブラウザセッション内の監視（gameStall / compositorHeartbeat / Aw, Snap! の
 * 監視者）は Chromium しか見ない。XSHM キャプチャ → x264 エンコードで固まり、
 * 配信ゲームページと統計用ブラウザの双方が元気なのに、外へ出た配信画面だけ
 * 静止している状態は、セッション内の監視では検知も回復もできない。ここでは
 * 配信ページを描画する統計用ブラウザが測った映像の動きに純ポリシー
 * (`lib/domain/broadcasting/CompositeFreezePolicy`) を重ねて、複数周期に
 * わたる静止を再起動で回復する。
 *
 * 回復は systemctl restart で行う:
 * - `obs` — makamujo-obs.service だけ
 * - `xorgAndObs` — makamujo-xvfb.service と makamujo-obs.service
 * - `browserAndBroadcastStack` — makamujo-xvfb + ゲーム用ブラウザ実体 + obs +
 *   配信サーバ makamujo-screen.service。表示を先に戻してから、その上に描く
 *   ブラウザと OBS を再起動する。配信サーバは最後に触る: watchdog 自身が
 *   この unit のプロセス（`bun start`）の中で動いており、ここで落ちると
 *   残りの unit の再起動が打ち切られる。
 *
 * ポリシーの状態（streak・ラング・クールダウン）はプロセスの寿命より長い。
 * サーバーは cron に 11 分ごとに殺され start されるので、メモリだけの状態では
 * 再起動のたびにラングが `obs` に戻り、OBS を何度も繰り返し落とすだけで
 * 合成出力は回復しない。`stateStore` で前プロセスの状態を引き継ぎ、深くなる。
 * ただし引き継いだ状態は放映外の周期では消さない: 放映中かは測定した
 * `<video>` の media clock の前進で判断し、進まない周期（番組終了の一枚絵 /
 * 測定不能）は streak だけリセットしてラングとクールダウンは残す。ここで
 * 状態を全消しすると、永続化した状態が消えてラングが永遠に `obs` のままで
 * あった（issue #927）。
 *
 * 放映中の根拠にわんコメのセッション（`streamState`）は使わない: cron の
 * 再起動直後は undefined で、わんコメの接続が切れていると毎周期を放映外と
 * みなして測定すら行わず、本物の合成出力の停止を放置する（issue #929/#933:
 * 音声と media clock は進み続け、外からの健康チェックだけが停止を繰り返し
 * 検知していた）。
 *
 * 測定の窓そのものが短い: 合図の 1 窓（`MOTION_WINDOW_MS=3s`）で静止を判定
 * できるので、`cyclesRequired` は既定 1。cron の採取周期は起動直後の 1 窓を
 * 初回 `tick` で測る。`/var` の状態に `stillCycles` を残しても、次のプロセスは
 * さらに深いラングから測り直すだけである（issue #989）。
 */

import { execFile } from "node:child_process";
import type {
  CompositeFreezeConfig,
  CompositeFreezeRecovery,
  CompositeFreezeState,
} from "../lib/domain/broadcasting/CompositeFreezePolicy";
import {
  COMPOSITE_FREEZE_DEFAULT_CONFIG,
  createCompositeFreezeState,
  observeCompositeFreezeCycle,
} from "../lib/domain/broadcasting/CompositeFreezePolicy";
import type { PictureMotion } from "./watchPageBrowser";
import { isOnAirFromClock, judgePictureMotion } from "./watchPageBrowser";

export const DEFAULT_FREEZE_CHECK_INTERVAL_MS = 60_000;

/**
 * 1 周期の測定に許す上限。
 *
 * 測定は広告待ち (90s)・計測可能な `<video>` 待ち (30s)・窓 (3s) を足しても
 * 2 分程度で終わる。レンダラが固まると `page.evaluate` はいつまでも帰らず、
 * `tick` が `ticking` のまま残ると以降の周期がすべて素通りして回復が永久に
 * 走らなくなる（外からの健康チェックだけが停止を検知し続ける）。上限を超えた
 * 周期は測定不能として捨て、次の周期へ進む。
 */
export const DEFAULT_MEASUREMENT_TIMEOUT_MS = 180_000;

/**
 * 回復ラングが触る systemd unit。unit 名は VPS の実構成のもの。
 *
 * 配信画面 `:10` の実体は ansible が導入する `makamujo-xvfb.service`
 * （`makamujo.service` が `Wants=` する）で、リポジトリ同梱の
 * `xorg10.service` は使われていない。誤った unit 名を渡すと
 * `systemctl restart` が失敗し、そのラングは何も回復できない。
 *
 * 最深ラングは ansible が束ねるアプリ三連（screen / browser / obs）に
 * `makamujo-xvfb.service` を合わせた形にする。画面の描画元である
 * `makamujo-screen.service`（配信サーバ。ゲーム状態・発話・アバター状態を
 * ページへ配る側）が抜けると、そこで起因する静止は最深ラングでも回復しない
 * （ブラウザを作り直しても、止まったサーバに繋ぎ直したページはすぐまた
 * 静止する）。watchdog 自身もこの unit のプロセス（`bun start`）の中で動いて
 * いるため、再起動すると自プロセスが SIGTERM で落ちて以降の unit に届かない。
 * そこで `makamujo-screen.service` はリストの最後に置き、他の unit の
 * 再起動が済んでから触る。表示 (`makamujo-xvfb.service`) はブラウザ / OBS /
 * 配信サーバより先に戻す: Xorg を後から落とすと、再起動したブラウザが表示を
 * 失ったまま残り、静止が回復しない。ポリシー状態は recover の前に永続化して
 * あるので、次に起動したプロセスは最深のラングから観測を再開できる。
 */
export const RECOVERY_SERVICES: Record<CompositeFreezeRecovery, string[]> = {
  obs: ["makamujo-obs.service"],
  xorgAndObs: ["makamujo-xvfb.service", "makamujo-obs.service"],
  browserAndBroadcastStack: [
    // 先に表示を戻す。ブラウザ / OBS / 配信サーバは DISPLAY=:10 に描くので、
    // Xorg を後から落とすと再起動したブラウザが表示を失ったまま残り、静止が
    // 回復しない。
    "makamujo-xvfb.service",
    "makamujo-browser.service",
    "makamujo-obs.service",
    // 意図的に最後: 再起動すると watchdog 自身のプロセスが落ちる。
    "makamujo-screen.service",
  ],
};

/** unit 間の間隔。Xorg を落としたあとの XSHM 再捕捉が落ち着くのを待つ。 */
const RESTART_SETTLE_MS = 3_000;
/** systemctl コマンドひとつぶんの上限。 */
const RESTART_COMMAND_TIMEOUT_MS = 60_000;

export interface SystemdRecoveryOptions {
  /** systemd の無い環境（開発 / CI）では dry run にして、予定の再起動をログに残すだけにする。 */
  dryRun?: boolean;
  log?: Pick<Console, "log" | "warn" | "error">;
}

/**
 * systemctl restart で回復を実行する口。dry run のときは何もせず、触る予定の
 * unit をログに残すだけ。
 */
export const createSystemdRecovery =
  (options: SystemdRecoveryOptions = {}) =>
  async (recovery: CompositeFreezeRecovery): Promise<void> => {
    const log = options.log ?? console;
    const services = RECOVERY_SERVICES[recovery];
    if (options.dryRun) {
      log.log(
        `[INFO] dry run: restarting ${services.join(" + ")} skipped (recovery "${recovery}")`,
      );
      return;
    }
    await restartServices(
      services,
      (service) => restartService(service, recovery, log),
      RESTART_SETTLE_MS,
      (ms) => Bun.sleep(ms),
    );
  };

/**
 * unit を順に再起動する。1 つの失敗で残りを諦めない: ラングは複数の unit を
 * 束ねていて、古い / 存在しない unit 名が 1 つ混じるだけで「より深い回復が
 * 何もしない」状態に陥る（実際に `xorg10.service` で起きていた）。試行後に
 * まとめて失敗を報告し、呼び出し側のログに残す。
 */
export const restartServices = async (
  services: readonly string[],
  restart: (service: string) => Promise<void>,
  settleMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> => {
  const failures: string[] = [];
  for (const index of services.keys()) {
    const service = services[index];
    if (service === undefined) continue;
    try {
      await restart(service);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    if (index + 1 < services.length) {
      await sleep(settleMs);
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
};

/** systemctl restart を 1 unit 実行する。応答が無いときは上限で reject する。 */
const restartService = (
  service: string,
  recovery: CompositeFreezeRecovery,
  log: Pick<Console, "log" | "warn" | "error">,
): Promise<void> => {
  log.log(`[INFO] restarting ${service} (recovery "${recovery}")...`);
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`systemctl restart ${service} timed out`));
    }, RESTART_COMMAND_TIMEOUT_MS);
    execFile(
      "systemctl",
      ["restart", service],
      { timeout: RESTART_COMMAND_TIMEOUT_MS },
      (error, stdout, stderr) => {
        clearTimeout(timeout);
        if (error !== null) {
          reject(
            new Error(
              `systemctl restart ${service} failed: ${error.message} ${stderr?.trim() ?? ""}`,
            ),
          );
        } else {
          void stdout;
          resolve();
        }
      },
    );
  });
};

const parsePositive = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export interface BroadcastFreezeWatchdogOptions {
  /**
   * 配信映像の動きを測る。`undefined` は測定不可（ページ未オープン、広告、
   * 実装が測れない）で、policy の `unknown` になる。
   */
  measurePictureMotion: () => Promise<PictureMotion | undefined>;
  /** 回復を実行する口。既定は systemctl（`createSystemdRecovery`）。 */
  recover?: (recovery: CompositeFreezeRecovery) => Promise<void>;
  /**
   * ポリシー状態の永続化口。cron の再起動をまたいでラングとクールダウンを
   * 引き継ぐ。省略時はメモリだけ（開発 / テスト）。
   */
  stateStore?: CompositeFreezeStateStore;
  /** ポリシー設定の差し替え口（テスト用）。既定は既定値 + 環境変数。 */
  config?: CompositeFreezeConfig;
  /** 観測間隔（ミリ秒）。 */
  intervalMs?: number;
  /**
   * 1 周期の測定に許す上限（ミリ秒）。超えたら測定不能として次の周期へ進む。
   * 省略時は `BROADCAST_FREEZE_MEASUREMENT_TIMEOUT_MS` か既定値。
   */
  measurementTimeoutMs?: number;
  env?: Record<string, string | undefined>;
  log?: Pick<Console, "log" | "warn" | "error">;
}

/** ポリシー状態の読み書き口。実体は `lib/application/compositeFreezeStateStore`。 */
export interface CompositeFreezeStateStore {
  load: () => CompositeFreezeState;
  save: (state: CompositeFreezeState) => void;
}

export interface BroadcastFreezeWatchdog {
  stop: () => void;
}

/**
 * 環境変数から周期とポリシー設定を読む。名前は gameStall の
 * `GAME_STALL_*` や watch page の `NICONAMA_WATCH_PAGE_READ_INTERVAL_MS`
 * と同じ「スコープ_意味」の並び。
 */
export const resolveBroadcastFreezeWatchdogEnv = (
  env: NodeJS.ProcessEnv = process.env,
): {
  intervalMs: number;
  measurementTimeoutMs: number;
  config: CompositeFreezeConfig;
} => ({
  intervalMs: parsePositive(
    env.BROADCAST_FREEZE_CHECK_INTERVAL_MS,
    DEFAULT_FREEZE_CHECK_INTERVAL_MS,
  ),
  measurementTimeoutMs: parsePositive(
    env.BROADCAST_FREEZE_MEASUREMENT_TIMEOUT_MS,
    DEFAULT_MEASUREMENT_TIMEOUT_MS,
  ),
  config: {
    cyclesRequired: parsePositive(
      env.BROADCAST_FREEZE_CYCLES,
      COMPOSITE_FREEZE_DEFAULT_CONFIG.cyclesRequired,
    ),
    recoveryCooldownMs: parsePositive(
      env.BROADCAST_FREEZE_RECOVERY_COOLDOWN_MS,
      COMPOSITE_FREEZE_DEFAULT_CONFIG.recoveryCooldownMs,
    ),
  },
});

/**
 * 測定を上限つきで待つ。`measure` が解決しないとき（レンダラ停止中の
 * `page.evaluate` など）に `tick` を永久に塞がない。返り値の `timedOut` が
 * true のとき、測定は破棄して `unknown` として扱う。
 */
export const measureWithTimeout = async (
  measure: () => Promise<PictureMotion | undefined>,
  timeoutMs: number,
): Promise<
  { timedOut: false; motion: PictureMotion | undefined } | { timedOut: true }
> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      measure().then((motion) => ({ timedOut: false as const, motion })),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

export const startBroadcastFreezeWatchdog = (
  options: BroadcastFreezeWatchdogOptions,
): BroadcastFreezeWatchdog => {
  const env = options.env ?? process.env;
  const log = options.log ?? console;
  const recover =
    options.recover ??
    (async (recovery) => {
      log.log(
        `[INFO] no recovery port is wired; would restart ${RECOVERY_SERVICES[recovery].join(" ")}`,
      );
    });
  const resolved = resolveBroadcastFreezeWatchdogEnv(env);
  const intervalMs = options.intervalMs ?? resolved.intervalMs;
  const measurementTimeoutMs =
    options.measurementTimeoutMs ?? resolved.measurementTimeoutMs;
  const config = options.config ?? resolved.config;

  let stopped = false;
  let ticking = false;
  let state: CompositeFreezeState =
    options.stateStore?.load() ?? createCompositeFreezeState();
  if (
    state.stillCycles > 0 ||
    state.recoveryIndex > 0 ||
    state.lastRecoveryAtMs !== undefined
  ) {
    // 前プロセスが残したラングを無視すると、cron の再起動ごとに `obs` から
    // 始まって OBS を落とすだけの永久運動になる。どこまで進んでいたかは
    // journal に残しておく（次に深いラングが動く理由が追えるように）。
    log.log(
      `[INFO] resumed the composite freeze state (stillCycles=${state.stillCycles}, recoveryIndex=${state.recoveryIndex}, lastRecoveryAtMs=${state.lastRecoveryAtMs ?? "none"})`,
    );
  }
  const persistState = (): void => {
    try {
      options.stateStore?.save(state);
    } catch (error) {
      log.warn(
        "[WARN] failed to persist the composite freeze state:",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const tick = async (): Promise<void> => {
    if (ticking) {
      return;
    }
    ticking = true;
    try {
      // 放映中かの根拠は、監視対象そのものである配信ページの `<video>` の
      // media clock の前進に置く（`isOnAirFromClock`）。わんコメの
      // `POST /api/meta` が張ったセッションを根拠にしていた頃は、cron の
      // 再起動直後に `streamState` が undefined であるうえ、わんコメの接続が
      // 切れていると毎周期を放映外とみなして測定すら行わず、本物の合成出力の
      // 停止を放置した（issue #929/#933）。measure を先に行うので、測定不能
      // （ページ未オープン / 広告 / tainted）は clock も読めず `undefined` に
      // なり、ポリシーには `unknown` として入る。
      //
      // 測定には上限を置く。例外は握れても、レンダラが固まったときの
      // `page.evaluate` は解決せず、`ticking` が立ったまま残ると以降の周期が
      // すべて素通りして回復が永久に走らなくなる（外からの健康チェックだけが
      // 停止を検知し続ける）。上限を超えた周期は測定不能として捨て、次の周期へ
      // 進む。
      const result = await measureWithTimeout(
        options.measurePictureMotion,
        measurementTimeoutMs,
      );
      if (result.timedOut) {
        log.warn(
          `[WARN] the picture motion measurement did not finish within ${measurementTimeoutMs}ms; treating this cycle as unmeasurable`,
        );
      }
      const measured = result.timedOut ? undefined : result.motion;
      if (measured === undefined || isOnAirFromClock(measured) !== true) {
        // 放映外（clock が進まない = 番組終了の一枚絵）または放映中か判断
        // できない周期は観測しない。ポリシーには `unknown` として投入して
        // streak をリセットするだけで、ラングとクールダウンは消さない: それは
        // すでに打了った回復の記録であり、「clock が進まない」ことは合成出力を
        // 回復した証拠ではない。ここで状態を全消しすると、cron の再起動ごとに
        // 永続化された状態が消え、issue #889 で引き継ぐようにしたはずのラングが
        // `obs` のまま深まらない（issue #927）。
        if (state.stillCycles !== 0) {
          state = observeCompositeFreezeCycle(
            state,
            { motion: "unknown", nowMs: Date.now() },
            config,
          ).state;
          persistState();
        }
        return;
      }
      const judged = judgePictureMotion(measured);
      const decision = observeCompositeFreezeCycle(
        state,
        { motion: judged ?? "unknown", nowMs: Date.now() },
        config,
      );
      state = decision.state;
      persistState();
      if (judged !== undefined) {
        log.log(
          `[INFO] measured the delivered picture (${judged}, ${measured.changedFrames}/${measured.comparedFrames} frames changed in ${Math.round(measured.windowMs)}ms, clock +${measured.clockAdvancedSeconds.toFixed(2)}s)`,
        );
      }
      if (decision.action !== undefined) {
        log.warn(
          `[WARN] the delivered picture has been still for consecutive cycles; recovering with "${decision.action}"`,
        );
        try {
          await recover(decision.action);
        } catch (error) {
          log.error(
            `[ERROR] recovery "${decision.action}" failed:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    } catch (error) {
      // 測定や回復が throw しても watchdog を殺さない: tick の外へ漏らすと
      // Bun の unhandled rejection になり、以降の周期が静かに止まる（issue #931）。
      log.error(
        "[ERROR] broadcast freeze watchdog tick failed:",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      ticking = false;
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
};
