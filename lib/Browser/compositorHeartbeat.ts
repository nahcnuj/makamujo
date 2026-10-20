/**
 * Detect a compositor that stopped producing frames while the page is still
 * answering `evaluate`.
 *
 * The game-stall watchdog compares successive screenshots, so it only catches
 * a canvas that keeps painting the same picture. When frame production itself
 * wedges (the renderer answers `evaluate` but no new frame is ever produced) a
 * screenshot call hangs, its rejection is swallowed by the stall probe's catch,
 * and the session sits wedged indefinitely — the stream shows a still picture
 * (the health checker reports "映像全体 / ゲーム画面部分が停止し続けています"
 * while audio keeps decoding). An in-page `requestAnimationFrame` probe is the
 * signal that separates "painting the same frame" from "not painting at all":
 * a healthy compositor runs a frame callback within milliseconds, a wedged one
 * never does.
 */

/**
 * How long the in-page probe waits for a compositor frame before it reports a
 * wedge. The budget is written as a literal inside the probe (see below).
 */
export const COMPOSITOR_HEARTBEAT_PROBE_BUDGET_MS = 3_000;

/**
 * In-page probe: resolves `true` when the compositor produced a frame,
 * `false` when none arrived within the budget.
 *
 * The probe must stay self-contained (no closure over module scope):
 * `browser.evaluate` re-creates the function from its source string inside the
 * page, so `COMPOSITOR_HEARTBEAT_PROBE_BUDGET_MS` cannot be referenced at run
 * time and the literal below is the budget. The unit test pins the literal so
 * the two cannot drift apart.
 */
export const compositorHeartbeatProbe = (): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (frameProduced: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(frameProduced);
    };
    requestAnimationFrame(() => finish(true));
    // Budget is a literal on purpose: `browser.evaluate` re-creates this
    // function from its source string inside the page, where a module-scope
    // reference like `COMPOSITOR_HEARTBEAT_PROBE_BUDGET_MS` is a
    // ReferenceError. Keep the value in step with the exported constant.
    setTimeout(() => finish(false), 3_000);
  });

export interface CompositorHeartbeatObservation {
  /** The in-page frame probe resolved; `undefined` when it could not run. */
  frameProduced: boolean | undefined;
  /**
   * The game is on a screen that must keep painting. Screens that legitimately
   * hold a still picture (title waiting for input, result during free talk) are
   * excluded so they are not mistaken for a wedge.
   */
  expectedToAnimate: boolean;
}

export interface CompositorHeartbeatState {
  /** Consecutive observations that saw no new frame while one was expected. */
  wedgedFrames: number;
}

export interface CompositorHeartbeatDecision {
  state: CompositorHeartbeatState;
  /** Frames stopped arriving long enough to treat the compositor as wedged. */
  wedged: boolean;
}

export const initialCompositorHeartbeatState =
  (): CompositorHeartbeatState => ({
    wedgedFrames: 0,
  });

/** True when no frame arrived (or the probe could not run) while one was due. */
export const isCompositorWedged = (
  expectedToAnimate: boolean,
  frameProduced: boolean | undefined,
): boolean => expectedToAnimate && frameProduced !== true;

/**
 * Fold one observation into the running state.
 *
 * A healthy probe or an expected-still screen clears the counter; consecutive
 * wedged observations count until `wedgedFrameThreshold` is reached, at which
 * point the state resets and `wedged` is reported once.
 */
export const observeCompositorHeartbeat = (
  state: CompositorHeartbeatState,
  observation: CompositorHeartbeatObservation,
  wedgedFrameThreshold: number,
): CompositorHeartbeatDecision => {
  if (
    !isCompositorWedged(
      observation.expectedToAnimate,
      observation.frameProduced,
    )
  ) {
    return { state: { wedgedFrames: 0 }, wedged: false };
  }
  const wedgedFrames = state.wedgedFrames + 1;
  if (wedgedFrames >= wedgedFrameThreshold) {
    return { state: { wedgedFrames: 0 }, wedged: true };
  }
  return { state: { wedgedFrames }, wedged: false };
};

/** How often the compositor is probed. */
export const DEFAULT_COMPOSITOR_HEARTBEAT_CHECK_MS = 5_000;

/** Wedged probes in a row that trigger a reload (~10s at the default interval). */
export const DEFAULT_COMPOSITOR_HEARTBEAT_WEDGED_FRAMES = 2;

const resolvePositiveInt = (
  raw: string | undefined,
  fallback: number,
): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Read `COMPOSITOR_HEARTBEAT_CHECK_MS`, falling back to the default. */
export const resolveCompositorHeartbeatCheckMs = (
  env: NodeJS.ProcessEnv = process.env,
): number =>
  resolvePositiveInt(
    env.COMPOSITOR_HEARTBEAT_CHECK_MS,
    DEFAULT_COMPOSITOR_HEARTBEAT_CHECK_MS,
  );

/** Read `COMPOSITOR_HEARTBEAT_WEDGED_FRAMES`, falling back to the default. */
export const resolveCompositorHeartbeatWedgedFrames = (
  env: NodeJS.ProcessEnv = process.env,
): number =>
  resolvePositiveInt(
    env.COMPOSITOR_HEARTBEAT_WEDGED_FRAMES,
    DEFAULT_COMPOSITOR_HEARTBEAT_WEDGED_FRAMES,
  );
