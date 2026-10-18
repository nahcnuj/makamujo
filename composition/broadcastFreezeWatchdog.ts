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
 * - `xorgAndObs` — xorg10.service と makamujo-obs.service
 * - `browserAndBroadcastStack` — ゲーム用ブラウザ実体 + xorg10 + obs
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

/** 回復ラングが触る systemd unit。unit 名は VPS の実構成のもの。 */
export const RECOVERY_SERVICES: Record<CompositeFreezeRecovery, string[]> = {
  obs: ["makamujo-obs.service"],
  xorgAndObs: ["xorg10.service", "makamujo-obs.service"],
  browserAndBroadcastStack: [
    "makamujo-browser.service",
    "xorg10.service",
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
    for (const index of services.keys()) {
      const service = services[index];
      if (service === undefined) continue;
      log.log(`[INFO] restarting ${service} (recovery "${recovery}")...`);
      await new Promise<void>((resolve, reject) => {
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
      if (index + 1 < services.length) {
        await Bun.sleep(RESTART_SETTLE_MS);
      }
    }
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
  /** ポリシー設定の差し替え口（テスト用）。既定は既定値 + 環境変数。 */
  config?: CompositeFreezeConfig;
  /** 観測間隔（ミリ秒）。 */
  intervalMs?: number;
  env?: Record<string, string | undefined>;
  log?: Pick<Console, "log" | "warn" | "error">;
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
  let state: CompositeFreezeState = createCompositeFreezeState();

  const tick = async (): Promise<void> => {
    if (ticking) {
      return;
    }
    ticking = true;
    try {
      if (!options.isStreamLive()) {
        // 放映外の静止は回復の意味を持たないので、見なかったことにする。
        state = createCompositeFreezeState();
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
      if (measured !== undefined) {
        // 判定不能（広告・tainted・サンプラが基準を解像できない）でも測定値は
        // 残す。回復が打たれない理由をログから追えるようにするため。
        log.log(
          `[INFO] measured the delivered picture (${judged ?? "unknown"}, ${measured.changedFrames}/${measured.comparedFrames} frames changed in ${Math.round(measured.windowMs)}ms)`,
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
