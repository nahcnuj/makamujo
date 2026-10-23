/**
 * Whether the overlay page inside the OBS browser source is still alive.
 *
 * The delivered picture is the OBS composite: the XSHM capture of the game
 * plus the browser source that shows the overlay page (`src/App.tsx`). The
 * overlay is what keeps the picture moving when the game itself stands still
 * — the heartbeat band sweeps across the full width, so the check
 * (`scripts/check-stream.ts`, unchanged: owner contract #807) sees changed
 * frames even on a frozen game screen.
 *
 * That band only helps while the browser source actually renders the page.
 * When the CEF renderer dies (killed by the memory pressure of the OBS
 * cgroup, crashed, or never loaded because OBS started before the
 * broadcasting server was serving the page) the browser source keeps its last
 * frame and the overlay contributes **no** motion at all. The external check
 * then reports the very freeze the band was introduced to prevent, and it
 * reports it for the whole session: the composite is only still when the game
 * is still too, so the numbers of the whole frame and of the game region are
 * identical (2026-10-22 14:27 JST: `videoMinFps` = `gameMinFps` = 14,
 * `videoAvgFps` = `gameAvgFps` = 18.3 — the overlay moved nothing).
 *
 * The picture-based watchdog (`composition/broadcastFreezeWatchdog.ts`) cannot
 * see that difference: it measures the whole delivered picture, which keeps
 * moving as long as the game moves. So the overlay needs its own liveness
 * signal: the page reports itself to the broadcasting server, and the server
 * restarts OBS when the reports stop. The decidable part lives here as a pure
 * policy: fold the observed beacons into "the overlay is gone" and let the
 * caller act on it.
 */

/** The state the policy keeps between observations. */
export interface OverlayLivenessState {
  /**
   * When the last beacon of the overlay page arrived (`undefined` = the page
   * has never reported itself).
   */
  lastBeaconAtMs: number | undefined;
  /** When the last recovery was started (`undefined` = nothing has run yet). */
  lastRecoveryAtMs: number | undefined;
}

export const createOverlayLivenessState = (): OverlayLivenessState => ({
  lastBeaconAtMs: undefined,
  lastRecoveryAtMs: undefined,
});

export interface OverlayLivenessConfig {
  /**
   * Silence longer than this means the overlay page is gone. The page sends a
   * beacon every 5 seconds, so a minute of silence is a dozen lost beacons.
   */
  silenceThresholdMs: number;
  /** Minimum gap between two recoveries. */
  recoveryCooldownMs: number;
}

export const OVERLAY_LIVENESS_DEFAULT_CONFIG: OverlayLivenessConfig = {
  silenceThresholdMs: 60_000,
  // The recovery is a restart of OBS. OBS needs a few seconds to come back and
  // to reload the browser source, and the page only reports itself again once
  // it is rendered, so the cooldown keeps a page that cannot be loaded from
  // turning into a restart loop.
  recoveryCooldownMs: 600_000,
};

/** One observation of the overlay page. */
export interface OverlayLivenessCycle {
  nowMs: number;
  /**
   * When the overlay page last reported itself (`undefined` = nothing is
   * known about the page).
   */
  lastBeaconAtMs: number | undefined;
}

/** What the caller has to do. */
export type OverlayLivenessAction = "restartObs";

export type OverlayLivenessDecision = {
  state: OverlayLivenessState;
  /** `undefined` = keep watching; otherwise run this action now. */
  action: OverlayLivenessAction | undefined;
};

/**
 * Take one observation into the running state.
 *
 * A page that never reported itself is not acted upon: the browser source may
 * simply not exist (no OBS, no stream), and restarting OBS in that case would
 * be noise. Only a page that reported itself and then went silent is treated
 * as gone — that is the failure the overlay's liveness signal exists for.
 *
 * A silent page triggers the recovery once the silence outlasts the
 * threshold, and again after the cooldown has elapsed. The cooldown anchor is
 * dropped as soon as the page reports itself again: the failure is over, and
 * the next one may act immediately.
 */
export const observeOverlayLiveness = (
  state: OverlayLivenessState,
  cycle: OverlayLivenessCycle,
  config: OverlayLivenessConfig = OVERLAY_LIVENESS_DEFAULT_CONFIG,
): OverlayLivenessDecision => {
  if (cycle.lastBeaconAtMs === undefined) {
    return { state, action: undefined };
  }
  if (cycle.nowMs - cycle.lastBeaconAtMs <= config.silenceThresholdMs) {
    return {
      state: {
        lastBeaconAtMs: cycle.lastBeaconAtMs,
        lastRecoveryAtMs: undefined,
      },
      action: undefined,
    };
  }
  const cooldownActive =
    state.lastRecoveryAtMs !== undefined &&
    cycle.nowMs - state.lastRecoveryAtMs < config.recoveryCooldownMs;
  if (cooldownActive) {
    return {
      state: { ...state, lastBeaconAtMs: cycle.lastBeaconAtMs },
      action: undefined,
    };
  }
  return {
    state: {
      lastBeaconAtMs: cycle.lastBeaconAtMs,
      lastRecoveryAtMs: cycle.nowMs,
    },
    action: "restartObs",
  };
};
