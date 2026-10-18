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
    setTimeout(() => finish(false), COMPOSITOR_HEARTBEAT_PROBE_BUDGET_MS);
  });

export interface CompositorHeartbeatObservation {
  /** The in-page frame probe resolved; `undefined` when it could not run. */
  frameProduced: boolean | undefined;
}

export interface CompositorHeartbeatState {
  /** Consecutive observations that saw no new compositor frame. */
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

/**
 * True when no frame arrived (or the probe could not run) while the page should
 * be alive.
 *
 * The game screen plays no role here: it describes content motion (the stall
 * probe's concern), while this probe measures the compositor, which must keep
 * presenting frames in every game state. Guarding on the screen also left two
 * blind spots — a wedge while the game sat on `title` / `result` / `unknown`
 * was ignored, and `sight()` failing on the wedged renderer itself made
 * `expectedToAnimate` false, dropping the wedge signal exactly when recovery
 * was needed.
 */
export const isCompositorWedged = (
  frameProduced: boolean | undefined,
): boolean => frameProduced !== true;

/**
 * Fold one observation into the running state.
 *
 * A healthy probe clears the counter; consecutive wedged observations count
 * until `wedgedFrameThreshold` is reached, at which
 * point the state resets and `wedged` is reported once.
 */
export const observeCompositorHeartbeat = (
  state: CompositorHeartbeatState,
  observation: CompositorHeartbeatObservation,
  wedgedFrameThreshold: number,
): CompositorHeartbeatDecision => {
  if (!isCompositorWedged(observation.frameProduced)) {
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
