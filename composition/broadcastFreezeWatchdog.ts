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
 * - `browserAndBroadcastStack` — ゲーム用ブラウザ実体 + makamujo-xvfb + obs
 *
 * ポリシーの状態（streak・ラング・クールダウン）はプロセスの寿命より長い。
 * サーバーは cron に 11 分ごとに殺され start されるので、メモリだけの状態では
 * 再起動のたびにラングが `obs` に戻り、OBS を何度も繰り返し落とすだけで
 * 合成出力は回復しない。`stateStore` で前プロセスの状態を引き継ぎ、深くなる。
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
import { judgePictureMotion } from "./watchPageBrowser";

export const DEFAULT_FREEZE_CHECK_INTERVAL_MS = 60_000;

/**
 * 回復ラングが触る systemd unit。unit 名は VPS の実構成のもの。
 *
 * 配信画面 `:10` の実体は ansible が導入する `makamujo-xvfb.service`
 * （`makamujo.service` が `Wants=` する）で、リポジトリ同梱の
 * `xorg10.service` は使われていない。誤った unit 名を渡すと
 * `systemctl restart` が失敗し、そのラングは何も回復できない。
 */
export const RECOVERY_SERVICES: Record<CompositeFreezeRecovery, string[]> = {
  obs: ["makamujo-obs.service"],
  xorgAndObs: ["makamujo-xvfb.service", "makamujo-obs.service"],
  browserAndBroadcastStack: [
    "makamujo-browser.service",
    "makamujo-xvfb.service",
    "makamujo-obs.service",
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
  /** 番組が放映中か。放映外の静止（番組終了の一枚絵）は回復の対象にしない。 */
  isStreamLive: () => boolean;
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
): { intervalMs: number; config: CompositeFreezeConfig } => ({
  intervalMs: parsePositive(
    env.BROADCAST_FREEZE_CHECK_INTERVAL_MS,
    DEFAULT_FREEZE_CHECK_INTERVAL_MS,
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
      if (!options.isStreamLive()) {
        // 放映外の静止は回復の意味を持たないので、見なかったことにする。
        state = createCompositeFreezeState();
        persistState();
        return;
      }
      const measured = await options.measurePictureMotion();
      const judged =
        measured === undefined ? "unknown" : judgePictureMotion(measured);
      const decision = observeCompositeFreezeCycle(
        state,
        { motion: judged ?? "unknown", nowMs: Date.now() },
        config,
      );
      state = decision.state;
      persistState();
      if (measured !== undefined && judged !== undefined) {
        log.log(
          `[INFO] measured the delivered picture (${judged}, ${measured.changedFrames}/${measured.comparedFrames} frames changed in ${Math.round(measured.windowMs)}ms)`,
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
