/**
 * Watch the overlay page of the OBS browser source and recover when it dies.
 *
 * The delivered picture is the OBS composite. The game part is the XSHM
 * capture, the overlay part is a browser source that loads the page this
 * server serves (`http://127.0.0.1:7777/`). The overlay is what keeps the
 * picture moving while the game stands still: the heartbeat band
 * (`src/components/BroadcastHeartbeat.tsx`) sweeps across the full width, so
 * the external check sees changed frames even on a frozen game screen.
 *
 * That band only reaches the picture while the browser source renders the
 * page. When the CEF renderer is gone — killed by the memory pressure of the
 * OBS cgroup, crashed, or never loaded because OBS started before this
 * server was serving the page — the browser source keeps its last frame and
 * the overlay contributes no motion at all. The composite then stands still
 * exactly when the game stands still, and the external check reports the
 * freeze the band was introduced to prevent (2026-10-22 15:43 JST:
 * `videoMinFps` = `gameMinFps` = 0 with the audio and the media clock still
 * running). The picture-based watchdog cannot see it: the whole delivered
 * picture keeps moving as long as the game moves, and the numbers of the
 * whole frame and of the game region come out identical
 * (2026-10-22 14:27 JST: `videoMinFps` = `gameMinFps` = 14).
 *
 * So the overlay reports itself: the page sends a beacon to this server
 * every few seconds, the server remembers when it last heard one, and a
 * monitor restarts OBS when the reports stop. The decision itself is a pure
 * policy (`lib/domain/broadcasting/OverlayLivenessPolicy.ts`).
 */

import {
  createOverlayLivenessState,
  OVERLAY_LIVENESS_DEFAULT_CONFIG,
  type OverlayLivenessConfig,
  type OverlayLivenessState,
  observeOverlayLiveness,
} from "../lib/domain/broadcasting/OverlayLivenessPolicy";

/** The path the overlay page reports itself to. */
export const OVERLAY_BEACON_PATH = "/api/overlay-beacon";

/** How often the monitor looks at the beacons. */
export const DEFAULT_OVERLAY_LIVENESS_CHECK_INTERVAL_MS = 30_000;

/**
 * Remembers when the overlay page last reported itself.
 *
 * The tracker is shared between the request handler that receives the
 * beacons and the monitor that watches them.
 */
export interface OverlayBeaconTracker {
  /** When the last beacon arrived (`undefined` = never). */
  lastBeaconAtMs: () => number | undefined;
  /** Record a beacon that just arrived. */
  record: (nowMs?: number) => void;
}

export const createOverlayBeaconTracker = (): OverlayBeaconTracker => {
  let lastBeaconAtMs: number | undefined;
  return {
    lastBeaconAtMs: () => lastBeaconAtMs,
    record: (nowMs = Date.now()) => {
      lastBeaconAtMs = nowMs;
    },
  };
};

export interface OverlayLivenessStateStore {
  load: () => OverlayLivenessState;
  save: (state: OverlayLivenessState) => void;
}

export interface OverlayLivenessMonitorOptions {
  /** Where the beacons of the overlay page are recorded. */
  tracker: OverlayBeaconTracker;
  /** The recovery to run. `restartObs` restarts the OBS unit. */
  recover: (action: "restartObs") => Promise<void>;
  /** Persists the state across the restarts of the server. */
  stateStore?: OverlayLivenessStateStore;
  /** Policy settings (test seam). */
  config?: OverlayLivenessConfig;
  /** How often the monitor looks at the beacons (test seam). */
  intervalMs?: number;
  /** Environment to read the settings from. */
  env?: Record<string, string | undefined>;
  log?: Pick<Console, "log" | "warn" | "error">;
}

export interface OverlayLivenessMonitor {
  stop: () => void;
  /** Run one observation now (test seam). */
  tick: () => Promise<void>;
}

const parsePositive = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Read the monitor settings from the environment. The names follow the
 * "SCOPE_MEANING" order of the other watchdogs (`BROADCAST_FREEZE_*`).
 */
export const resolveOverlayLivenessEnv = (
  env: NodeJS.ProcessEnv = process.env,
): {
  intervalMs: number;
  config: OverlayLivenessConfig;
} => ({
  intervalMs: parsePositive(
    env.OVERLAY_LIVENESS_CHECK_INTERVAL_MS,
    DEFAULT_OVERLAY_LIVENESS_CHECK_INTERVAL_MS,
  ),
  config: {
    silenceThresholdMs: parsePositive(
      env.OVERLAY_LIVENESS_SILENCE_THRESHOLD_MS,
      OVERLAY_LIVENESS_DEFAULT_CONFIG.silenceThresholdMs,
    ),
    recoveryCooldownMs: parsePositive(
      env.OVERLAY_LIVENESS_RECOVERY_COOLDOWN_MS,
      OVERLAY_LIVENESS_DEFAULT_CONFIG.recoveryCooldownMs,
    ),
  },
});

/**
 * Start watching the beacons of the overlay page.
 *
 * The monitor never throws out of a tick: an exception that escapes would
 * leave the timer in a broken state and the overlay would stay dead without
 * anybody noticing.
 */
export const startOverlayLivenessMonitor = (
  options: OverlayLivenessMonitorOptions,
): OverlayLivenessMonitor => {
  const env = options.env ?? process.env;
  const log = options.log ?? console;
  const resolved = resolveOverlayLivenessEnv(env);
  const intervalMs = options.intervalMs ?? resolved.intervalMs;
  const config = options.config ?? resolved.config;

  let stopped = false;
  let ticking = false;
  const startedAtMs = Date.now();
  let state: OverlayLivenessState =
    options.stateStore?.load() ?? createOverlayLivenessState();

  const persistState = (): void => {
    try {
      options.stateStore?.save(state);
    } catch (error) {
      log.warn(
        "[WARN] failed to persist the overlay liveness state:",
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
      const nowMs = Date.now();
      const trackedBeaconAtMs = options.tracker.lastBeaconAtMs();
      // A beacon that arrived in this process is the direct evidence that the
      // page is alive. A beacon the state remembers comes from before the
      // last restart of the server: it only becomes evidence once this
      // process has been running long enough for the silence to mean
      // something. Right after a restart the page needs a few seconds to send
      // its first beacon, and the remembered beacon is already minutes old —
      // acting on it would restart OBS on every restart of the server.
      const lastBeaconAtMs =
        trackedBeaconAtMs ??
        (nowMs - startedAtMs >= config.silenceThresholdMs
          ? state.lastBeaconAtMs
          : undefined);
      const decision = observeOverlayLiveness(
        state,
        {
          nowMs,
          lastBeaconAtMs,
        },
        config,
      );
      state = decision.state;
      persistState();
      if (decision.action === undefined) {
        return;
      }
      log.warn(
        "[WARN] the overlay page stopped reporting itself; restarting OBS",
      );
      try {
        await options.recover(decision.action);
      } catch (error) {
        log.error(
          "[ERROR] the overlay recovery failed:",
          error instanceof Error ? error.message : String(error),
        );
      }
    } catch (error) {
      log.error(
        "[ERROR] the overlay liveness tick failed:",
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
    tick,
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
};
