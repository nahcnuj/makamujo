/**
 * Reaction policy for the delivered picture that stays still for minutes.
 *
 * The scheduled health checker reads the watch page from the outside, so it is
 * the authority that *detects* anomalies — but it cannot heal them, and the
 * browser-session watchdogs only see Chromium. No probe inside the session
 * watches the **composite output** (the x264 encode fed by the XSHM capture of
 * Xorg :10 — the picture nicovideo actually delivers): when that composite
 * freezes while the game page keeps animating, only restarting OBS / Xorg
 * helps. Recovery therefore has to run where the restart commands exist — on
 * the streaming host. The decidable part lives here as a pure policy:
 * fold per-cycle observations "the delivered picture measured still" and take
 * the next rung of the escalation ladder only after consecutive still cycles
 * while the cooldown since the previous recovery has elapsed. A legitimately
 * still stretch (result screen during free-talk, an expired program) is over
 * within one check cycle, so a multi-cycle run is required before acting.
 */

/** Recovery actions in escalation order. Deeper ones restart more services. */
export const COMPOSITE_FREEZE_RECOVERIES = [
  "obs",
  "xorgAndObs",
  "browserAndBroadcastStack",
] as const;

export type CompositeFreezeRecovery =
  (typeof COMPOSITE_FREEZE_RECOVERIES)[number];

export interface CompositeFreezeState {
  /** Consecutive cycles in a row that measured the picture still. */
  stillCycles: number;
  /** Which rung of the recovery ladder is next. */
  recoveryIndex: number;
  /** When the last recovery ran (`undefined` = nothing has run yet). */
  lastRecoveryAtMs: number | undefined;
}

export const createCompositeFreezeState = (): CompositeFreezeState => ({
  stillCycles: 0,
  recoveryIndex: 0,
  lastRecoveryAtMs: undefined,
});
/**
 * One cycle's measurement of the delivered picture.
 * `still` — the sampler saw the picture stop changing while presenting frames;
 * `moving` — the picture kept changing (healthy);
 * `unknown` — unmeasurable (no video yet, mid-roll advertisement, player
 * rebuilding its element, the sampling racing a navigation). Mid-roll
 * advertisements freeze the live `<video>` exactly like a stall, so judging
 * them would report healthy streams as still and bridging the streak across
 * one would let an advertisement carry a freeze streak. Unmeasurable cycles
 * therefore reset the streak — but nothing else: the recovery ladder and the
 * cooldown are the record of recoveries that already ran, and "this cycle
 * could not be measured" is not evidence that the composite recovered.
 */
export type CompositeFreezeMotion = "still" | "moving" | "unknown";

export interface CompositeFreezeCycle {
  motion: CompositeFreezeMotion;
  nowMs: number;
}

export interface CompositeFreezeConfig {
  /** Still cycles must continue in a row before any recovery runs. */
  cyclesRequired: number;
  /** Minimum gap between two recoveries. */
  recoveryCooldownMs: number;
}

export const COMPOSITE_FREEZE_DEFAULT_CONFIG: CompositeFreezeConfig = {
  cyclesRequired: 3,
  recoveryCooldownMs: 600_000,
};

export type CompositeFreezeDecision = {
  state: CompositeFreezeState;
  /** `undefined` = keep watching; otherwise run this recovery now. */
  action: CompositeFreezeRecovery | undefined;
};

const frozenState = (state: CompositeFreezeState): CompositeFreezeState => ({
  ...state,
  stillCycles: state.stillCycles + 1,
});

const resetState = (): CompositeFreezeState => createCompositeFreezeState();

/**
 * Take one cycle's measurement into the running state.
 *
 * `moving` (the picture proved healthy) resets everything: the streak, the
 * ladder, and the cooldown anchor, so the next freeze starts from the first
 * rung. `unknown` resets only the streak: an unmeasurable cycle is not proof
 * that the composite recovered, so the ladder position and the cooldown of a
 * recovery that already ran are kept — otherwise a stream that cannot be
 * measured every cycle (mid-roll advertisements, the player rebuilding its
 * element, the process restarting) would never climb past the first rung and
 * the deepest rungs would stay unreachable for exactly the freezes they exist
 * for.
 *
 * A `still` streak accumulates; once it reaches `cyclesRequired` and the
 * cooldown has elapsed, the next rung of the ladder runs and the streak
 * restarts from the following cycle, with the ladder position advanced for the
 * next time.
 */
export const observeCompositeFreezeCycle = (
  state: CompositeFreezeState,
  cycle: CompositeFreezeCycle,
  config: CompositeFreezeConfig = COMPOSITE_FREEZE_DEFAULT_CONFIG,
): CompositeFreezeDecision => {
  if (cycle.motion === "moving") {
    return { state: resetState(), action: undefined };
  }
  if (cycle.motion === "unknown") {
    return { state: { ...state, stillCycles: 0 }, action: undefined };
  }

  const stillCycles = state.stillCycles + 1;
  if (
    stillCycles < config.cyclesRequired ||
    (state.lastRecoveryAtMs !== undefined &&
      cycle.nowMs - state.lastRecoveryAtMs < config.recoveryCooldownMs)
  ) {
    return { state: frozenState(state), action: undefined };
  }

  const rungIndex = Math.min(
    state.recoveryIndex,
    COMPOSITE_FREEZE_RECOVERIES.length - 1,
  );
  return {
    state: {
      stillCycles: 0,
      recoveryIndex: Math.min(
        rungIndex + 1,
        COMPOSITE_FREEZE_RECOVERIES.length - 1,
      ),
      // The cooldown is anchored to when the recovery actually runs, so the
      // measured picture has a fair chance to settle before the next rung.
      lastRecoveryAtMs: cycle.nowMs,
    },
    action: COMPOSITE_FREEZE_RECOVERIES[rungIndex],
  };
};
