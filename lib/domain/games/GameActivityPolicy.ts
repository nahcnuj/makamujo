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
 */

/** Longest a round may stay off the playing screen before it is restarted. */
export const DEFAULT_GAME_ACTIVITY_TIMEOUT_MS = 120_000;

export interface GameActivityState {
  /**
   * Epoch ms of the first sight, after the game was last seen playing, that was
   * not the playing screen. `undefined` while the game is playing.
   */
  nonPlayingSinceMs: number | undefined;
}

export const initialGameActivityState = (): GameActivityState => ({
  nonPlayingSinceMs: undefined,
});

export interface GameActivityObservation {
  /** The latest sight saw the playing screen (round is in progress). */
  playing: boolean;
  /** Current epoch ms. */
  nowMs: number;
}

export interface GameActivityDecision {
  state: GameActivityState;
  /** The round should be started over (open the URL, then click start). */
  restart: boolean;
}

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
    return { state: initialGameActivityState(), restart: false };
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
