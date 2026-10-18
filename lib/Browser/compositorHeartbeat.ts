/**
 * Detect a compositor that stopped producing frames — or that produces them
 * too slowly to keep the stream moving — while the page is still answering
 * `evaluate`.
 *
 * The game-stall watchdog compares successive screenshots, so it only catches
 * a canvas that keeps painting the same picture. When frame production itself
 * wedges (the renderer answers `evaluate` but no new frame is ever produced) a
 * screenshot call hangs, its rejection is swallowed by the stall probe's catch,
 * and the session sits wedged indefinitely — the stream shows a still picture
 * (the health checker reports "映像全体 / ゲーム画面部分が停止し続けています"
 * while audio keeps decoding). An in-page `requestAnimationFrame` probe is the
 * signal that separates "painting the same frame" from "not painting at all":
 * a healthy compositor runs a frame callback at the display rate, a wedged one
 * never does.
 *
 * Merely counting *whether* a frame arrived is not enough. The health checker
 * judges the stream by how many frames per second keep changing (24 for the
 * whole picture, 8 for the game panel), so a compositor that answers the
 * boolean probe with one lonely frame every few seconds leaves the stream
 * frozen enough to fail every check while this watchdog stays quiet. The probe
 * therefore counts the frames it sees in its budget, and a count below
 * {@link DEFAULT_COMPOSITOR_HEARTBEAT_MIN_FPS} is treated exactly like a
 * compositor that never produced one: reload, then restart the session.
 */

/**
 * How long the in-page probe waits for compositor frames before it reports.
 * The budget is written as a literal inside the probe (see below).
 */
export const COMPOSITOR_HEARTBEAT_PROBE_BUDGET_MS = 3_000;

/**
 * In-page probe: counts the frames the compositor produced and resolves with
 * that count once the budget expires.
 *
 * The probe must stay self-contained (no closure over module scope):
 * `browser.evaluate` re-creates the function from its source string inside the
 * page, so `COMPOSITOR_HEARTBEAT_PROBE_BUDGET_MS` cannot be referenced at run
 * time and the literal below is the budget. The unit test pins the literal so
 * the two cannot drift apart.
 */
export const compositorHeartbeatProbe = (): Promise<number> =>
  new Promise<number>((resolve) => {
    let frames = 0;
    let finished = false;
    const tick = (): void => {
      if (finished) return;
      frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => {
      finished = true;
      resolve(frames);
    }, COMPOSITOR_HEARTBEAT_PROBE_BUDGET_MS);
  });

export interface CompositorHeartbeatObservation {
  /** Frames the in-page probe counted; `undefined` when it could not run. */
  frameCount: number | undefined;
}

export interface CompositorHeartbeatState {
  /** Consecutive observations that saw too few frames. */
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
 * True when no usable number of frames arrived while one was due.
 *
 * Both a probe that could not run (`undefined`, e.g. the evaluate timed out)
 * and one that counted fewer frames than `minFrames` mean the stream cannot
 * keep moving; either way the window cannot be judged healthy.
 */
export const isCompositorWedged = (
  frameCount: number | undefined,
  minFrames: number,
): boolean => frameCount === undefined || frameCount < minFrames;

/**
 * Fold one observation into the running state.
 *
 * A healthy probe clears the counter; consecutive wedged observations count
 * until `wedgedFrameThreshold` is reached, at which point the state resets and
 * `wedged` is reported once.
 */
export const observeCompositorHeartbeat = (
  state: CompositorHeartbeatState,
  observation: CompositorHeartbeatObservation,
  wedgedFrameThreshold: number,
  minFrames: number,
): CompositorHeartbeatDecision => {
  if (!isCompositorWedged(observation.frameCount, minFrames)) {
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

/**
 * Frames per second the probe must see before the compositor counts as
 * healthy. The health checker fails the stream below 24 changed frames per
 * second for the whole picture, so this floor sits well below that: it stays
 * quiet for a busy page (the probe counts at the display rate) and only trips
 * when the compositor is starving the page hard enough that the picture the
 * stream shows has already become a slideshow.
 */
export const DEFAULT_COMPOSITOR_HEARTBEAT_MIN_FPS = 10;

/** Frames the probe must count within its budget to clear {@link minFps}. */
export const minFramesWithinBudget = (
  minFps: number,
  budgetMs: number = COMPOSITOR_HEARTBEAT_PROBE_BUDGET_MS,
): number => Math.max(1, Math.round((minFps * budgetMs) / 1000));

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

/** Read `COMPOSITOR_HEARTBEAT_MIN_FPS`, falling back to the default. */
export const resolveCompositorHeartbeatMinFps = (
  env: NodeJS.ProcessEnv = process.env,
): number =>
  resolvePositiveInt(
    env.COMPOSITOR_HEARTBEAT_MIN_FPS,
    DEFAULT_COMPOSITOR_HEARTBEAT_MIN_FPS,
  );
