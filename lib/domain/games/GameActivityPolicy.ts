/**
 * Detect a game round that stopped progressing while the browser session is
 * still alive.
 *
 * The browser-session watchdogs cover a page that stopped answering `evaluate`
 * or stopped painting (byte-identical frames). Neither notices a game that keeps
 * answering but never leaves a non-playing screen again: a stuck title or result
 * screen leaves the composited stream still — the health checker reports
 * "映像全体 / ゲーム画面部分が停止し続けています" while the voice keeps playing —
 * even though every session watchdog is content. Only the server owns the action
 * sequence that starts a round (open the URL, click start), so this policy
 * decides when it should start one over.
 *
 * A round can also stall while it is still on the playing screen: the canvas
 * keeps animating but the score stops moving, so the picture never changes in a
 * way the stream can show. Tracking the last score/level change catches that.
 */

/** Longest a round may stay off the playing screen before it is restarted. */
export const DEFAULT_GAME_ACTIVITY_TIMEOUT_MS = 120_000;

export interface GameActivityState {
  /**
   * Epoch ms of the first sight, after the game was last seen playing, that was
   * not the playing screen. `undefined` while the game is playing.
   */
  nonPlayingSinceMs: number | undefined;
  /** Epoch ms of the last observed score/level change while playing. */
  lastProgressMs?: number;
  /** Last observed score while playing. */
  lastScore?: number;
  /** Last observed level while playing. */
  lastLevel?: number;
}

export const initialGameActivityState = (): GameActivityState => ({
  nonPlayingSinceMs: undefined,
});

export interface GameActivityObservation {
  /** The latest sight saw the playing screen (round is in progress). */
  playing: boolean;
  /** Current epoch ms. */
  nowMs: number;
  /** Optional current score; progress is inferred from changes. */
  score?: number;
  /** Optional current level; progress is inferred from changes. */
  level?: number;
  /** Optional explicit progress flag supplied by the caller. */
  progressed?: boolean;
  changed?: boolean;
  scoreChanged?: boolean;
  levelChanged?: boolean;
  moved?: boolean;
}

export interface GameActivityDecision {
  state: GameActivityState;
  /** The round should be started over (open the URL, then click start). */
  restart: boolean;
}

const hasProgressSignal = (observation: GameActivityObservation): boolean =>
  observation.progressed === true ||
  observation.changed === true ||
  observation.scoreChanged === true ||
  observation.levelChanged === true ||
  observation.moved === true;

/**
 * Fold one sight into the running state.
 *
 * A sight of the playing screen clears the clock (the round is alive). Any
 * other screen — including a failed sight — starts it, and `restart` is reported
 * once the clock has run for `timeoutMs`, after which the clock is reset so a
 * game that stays stuck is retried rather than hammered. A non-positive timeout
 * disables the check.
 */
export const observeGameActivity = (
  state: GameActivityState,
  observation: GameActivityObservation,
  timeoutMs: number,
): GameActivityDecision => {
  if (observation.playing) {
    const explicitProgress = hasProgressSignal(observation);
    const scoreProgress =
      typeof observation.score === "number" &&
      state.lastScore !== undefined &&
      observation.score !== state.lastScore;
    const levelProgress =
      typeof observation.level === "number" &&
      state.lastLevel !== undefined &&
      observation.level !== state.lastLevel;
    const firstProgressSample =
      state.lastScore === undefined &&
      state.lastLevel === undefined &&
      state.lastProgressMs === undefined;
    const progressed =
      explicitProgress ||
      scoreProgress ||
      levelProgress ||
      firstProgressSample ||
      (typeof observation.score !== "number" &&
        typeof observation.level !== "number" &&
        !hasProgressSignal(observation));
    const lastScore =
      typeof observation.score === "number"
        ? observation.score
        : state.lastScore;
    const lastLevel =
      typeof observation.level === "number"
        ? observation.level
        : state.lastLevel;
    const lastProgressMs = progressed
      ? observation.nowMs
      : (state.lastProgressMs ?? observation.nowMs);

    if (
      timeoutMs > 0 &&
      !firstProgressSample &&
      (typeof observation.score === "number" ||
        typeof observation.level === "number" ||
        hasProgressSignal(observation)) &&
      !progressed &&
      state.lastProgressMs !== undefined &&
      observation.nowMs - state.lastProgressMs >= timeoutMs
    ) {
      return { state: initialGameActivityState(), restart: true };
    }

    return {
      state: {
        nonPlayingSinceMs: undefined,
        lastProgressMs,
        lastScore,
        lastLevel,
      },
      restart: false,
    };
  }

  const nonPlayingSinceMs = state.nonPlayingSinceMs ?? observation.nowMs;
  if (timeoutMs > 0 && observation.nowMs - nonPlayingSinceMs >= timeoutMs) {
    return { state: { nonPlayingSinceMs: observation.nowMs }, restart: true };
  }
  return { state: { nonPlayingSinceMs }, restart: false };
};

const resolvePositiveInt = (
  raw: string | undefined,
  fallback: number,
): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Read `GAME_ACTIVITY_TIMEOUT_MS`, falling back to the default. */
export const resolveGameActivityTimeoutMs = (
  env: NodeJS.ProcessEnv = process.env,
): number =>
  resolvePositiveInt(
    env.GAME_ACTIVITY_TIMEOUT_MS,
    DEFAULT_GAME_ACTIVITY_TIMEOUT_MS,
  );
