/**
 * Detect a game page that stopped painting while it is still answering
 * `evaluate`.
 *
 * The Aw, Snap! watchdog only inspects the DOM, so a page whose renderer keeps
 * servicing `evaluate` but whose canvas stopped updating is reported as
 * healthy — yet the stream shows a still picture (the health checker flags it
 * as "映像全体 / ゲーム画面部分が停止し続けています" while audio keeps playing).
 * Comparing successive screenshots of the page is the one signal available
 * inside the session that catches that state.
 */

/** True when both probes are present and byte-identical. */
export const areFramesIdentical = (
  previous: Uint8Array | undefined,
  current: Uint8Array | undefined,
): boolean => {
  if (previous === undefined || current === undefined) return false;
  if (previous.length !== current.length) return false;
  for (let index = 0; index < previous.length; index++) {
    if ((previous[index] ?? 0) !== (current[index] ?? 0)) return false;
  }
  return true;
};

export interface GameStallState {
  /** A previous frame is available to compare against. */
  hasBaseline: boolean;
  /** Consecutive identical frames observed while animation was expected. */
  staticFrames: number;
}

export const initialGameStallState = (): GameStallState => ({
  hasBaseline: false,
  staticFrames: 0,
});

export interface GameStallObservation {
  /** The current frame is byte-identical to the previous observation. */
  identicalToPrevious: boolean;
  /**
   * The current screen is expected to keep animating. A screen that legitimately
   * holds a still picture (e.g. the result screen during the free-talk window)
   * is excluded so it is not mistaken for a stall.
   */
  expectedToAnimate: boolean;
}

export interface GameStallDecision {
  state: GameStallState;
  /** The page has been static for long enough to be treated as frozen. */
  stalled: boolean;
}

/**
 * Fold one observation into the running state.
 *
 * The first observable frame only establishes a baseline. Identical frames are
 * counted until `staticFrameThreshold` is reached, at which point the state
 * resets and `stalled` is reported once; any changed frame or an expected-still
 * screen clears the counter.
 */
export const observeGameFrame = (
  state: GameStallState,
  observation: GameStallObservation,
  staticFrameThreshold: number,
): GameStallDecision => {
  if (!observation.expectedToAnimate || !state.hasBaseline) {
    return { state: { hasBaseline: true, staticFrames: 0 }, stalled: false };
  }
  if (staticFrameThreshold <= 0) {
    // A non-positive threshold disables the stall detection instead of
    // tripping on the very first identical frame.
    return { state: { hasBaseline: true, staticFrames: 0 }, stalled: false };
  }
  if (!observation.identicalToPrevious) {
    return { state: { hasBaseline: true, staticFrames: 0 }, stalled: false };
  }
  const staticFrames = state.staticFrames + 1;
  if (staticFrames >= staticFrameThreshold) {
    return { state: { hasBaseline: true, staticFrames: 0 }, stalled: true };
  }
  return { state: { hasBaseline: true, staticFrames }, stalled: false };
};

/**
 * True when reloading the page has not restored the picture and the whole
 * session should be restarted for a clean Chromium process.
 */
export const shouldRestartGameSession = (
  consecutiveStalls: number,
  limit: number,
): boolean => limit > 0 && consecutiveStalls >= limit;

export interface StallEscalationState {
  /** Reloads attempted since the picture last demonstrably changed. */
  consecutiveStalls: number;
}

export const initialStallEscalationState = (): StallEscalationState => ({
  consecutiveStalls: 0,
});

export interface StallProbeObservation {
  /** The page has been static long enough to be treated as frozen. */
  stalled: boolean;
  /**
   * The current frame differs from the previous observation, which proves the
   * page is painting. The first probe after a reload has no baseline and must
   * report `false`.
   */
  frameChanged: boolean;
}

export interface StallProbeDecision {
  state: StallEscalationState;
  /** The page should be reloaded to try to restore painting. */
  reload: boolean;
  /** Reloading has not restored painting; the whole session should restart. */
  restartSession: boolean;
}

/**
 * Fold one stall probe into the reload budget.
 *
 * The budget must only be cleared by a frame that actually changed. The first
 * probe after a reload has no baseline, so it reports `frameChanged === false`
 * even though the page is healthy; clearing the budget on it made a page that
 * never recovered reload forever instead of ever reaching the session-restart
 * threshold, leaving the stream frozen for hours. A non-positive `reloadLimit`
 * disables the restart (the page is reloaded on every stall instead).
 */
export const observeStallProbe = (
  state: StallEscalationState,
  observation: StallProbeObservation,
  reloadLimit: number,
): StallProbeDecision => {
  if (!observation.stalled) {
    return {
      state: observation.frameChanged ? initialStallEscalationState() : state,
      reload: false,
      restartSession: false,
    };
  }
  const consecutiveStalls = state.consecutiveStalls + 1;
  if (shouldRestartGameSession(consecutiveStalls, reloadLimit)) {
    return {
      state: initialStallEscalationState(),
      reload: false,
      restartSession: true,
    };
  }
  return {
    state: { consecutiveStalls },
    reload: true,
    restartSession: false,
  };
};

/** How often the page is screenshotted for the stall probe. */
export const DEFAULT_GAME_STALL_CHECK_MS = 10_000;
/** Identical frames needed to declare a stall (~60s at the default interval). */
export const DEFAULT_GAME_STALL_STATIC_FRAMES = 6;

const resolvePositiveInt = (
  raw: string | undefined,
  fallback: number,
): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Read `GAME_STALL_CHECK_MS`, falling back to the default. */
export const resolveGameStallCheckMs = (
  env: NodeJS.ProcessEnv = process.env,
): number =>
  resolvePositiveInt(env.GAME_STALL_CHECK_MS, DEFAULT_GAME_STALL_CHECK_MS);

/** Read `GAME_STALL_STATIC_FRAMES`, falling back to the default. */
export const resolveGameStallStaticFrames = (
  env: NodeJS.ProcessEnv = process.env,
): number =>
  resolvePositiveInt(
    env.GAME_STALL_STATIC_FRAMES,
    DEFAULT_GAME_STALL_STATIC_FRAMES,
  );
