// Solver for 落ち物パズルゲーム・蘇 (vigilant-fiesta).
import { Action, type State } from "automated-gameplay-transmitter";
import { getGameHomeUrl } from "./server";
import type { ScreenName } from "./State";

/** Default wait on the result screen for free talk before clicking retry. */
export const DEFAULT_FREE_TALK_MS = 30_000;

/**
 * Free-talk window after game over.
 * Override with `VIGILANT_FIESTA_FREE_TALK_MS` (milliseconds).
 */
export const resolveFreeTalkMs = (): number => {
  const raw = process.env.VIGILANT_FIESTA_FREE_TALK_MS?.trim();
  if (!raw) return DEFAULT_FREE_TALK_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FREE_TALK_MS;
};

/** @deprecated Prefer resolveFreeTalkMs() so env overrides apply at call time. */
export const FREE_TALK_MS = DEFAULT_FREE_TALK_MS;

export type GameState =
  | {
    type: "initialize";
    phase?: "open" | "start";
  }
  | {
    type: "idle";
    phase?: "sight" | "act" | "freeTalk";
    /** Epoch ms when free-talk window ends (result screen). */
    freeTalkUntil?: number;
  }
  | { type: "closed" };

type SolverEventListeners = {
  onSave: Array<(text: string) => void>;
  isSilent: () => boolean;
};

export type SolverStart =
  | { type: "initialize"; data?: string }
  | { type: "closed" };

export const States = {
  initialize: (): Extract<GameState, { type: "initialize" }> => ({
    type: "initialize",
    phase: "open",
  }),
  idle: (): Extract<GameState, { type: "idle" }> => ({
    type: "idle",
    phase: "sight",
  }),
  closed: (): Extract<GameState, { type: "closed" }> => ({ type: "closed" }),
};

export function hydrate(state: GameState | SolverStart): GameState {
  switch (state.type) {
    case "initialize":
      return {
        type: "initialize",
        phase: "phase" in state && state.phase ? state.phase : "open",
      };
    case "idle":
      return {
        type: "idle",
        phase: "phase" in state && state.phase ? state.phase : "sight",
        freeTalkUntil: "freeTalkUntil" in state ? state.freeTalkUntil : undefined,
      };
    case "closed":
      return { type: "closed" };
  }
}

type SightLike = {
  screen?: ScreenName;
  score?: number;
  level?: number;
};

const pickPlayAction = (): Action.Action => {
  // Lightweight random policy: move / rotate / hard-drop.
  // Weights favor hard-drop so the board progresses for stream viewers.
  const roll = Math.random();
  if (roll < 0.25) return { name: "press", key: "ArrowLeft", on: { selector: "body" } };
  if (roll < 0.5) return { name: "press", key: "ArrowRight", on: { selector: "body" } };
  if (roll < 0.7) return { name: "press", key: "ArrowDown", on: { selector: "body" } };
  return { name: "press", key: "ArrowUp", on: { selector: "body" } };
};

export function stepInitialize(
  state: Extract<GameState, { type: "initialize" }>,
  event: State | undefined,
): { state: GameState; action?: Action.Action } {
  if (event?.name === "closed") {
    return { state: { type: "closed" } };
  }

  const phase = state.phase ?? "open";
  switch (phase) {
    case "open": {
      if (event === undefined) {
        return {
          state,
          action: Action.open(getGameHomeUrl()),
        };
      }
      if (event.name === "result" && event.succeeded === false) {
        return { state: { ...state, phase: "open" } };
      }
      return { state: { ...state, phase: "start" } };
    }
    case "start": {
      if (event === undefined) {
        return {
          state,
          action: Action.clickByElementId("btn-start"),
        };
      }
      // Start is best-effort; enter play loop even if click fails (may already be playing).
      return { state: States.idle() };
    }
  }
}

export function* handleInitialize(
  state: Extract<GameState, { type: "initialize" }>,
): Generator<Action.Action, GameState, State> {
  let s: Extract<GameState, { type: "initialize" }> = {
    type: "initialize",
    phase: state.phase ?? "open",
  };
  let event: State | undefined;

  for (;;) {
    const prevPhase = s.phase;
    const out = stepInitialize(s, event);
    if (out.state.type !== "initialize") {
      return out.state;
    }
    s = out.state;
    if (!out.action) {
      if (event !== undefined && s.phase === prevPhase) {
        return s;
      }
      event = undefined;
      continue;
    }
    event = yield out.action;
  }
}

export function stepIdle(
  state: Extract<GameState, { type: "idle" }>,
  event: State | undefined,
  nowMs: number = Date.now(),
): { state: GameState; action?: Action.Action } {
  if (event?.name === "closed") {
    return { state: { type: "closed" } };
  }

  const phase = state.phase ?? "sight";
  switch (phase) {
    case "sight": {
      if (event === undefined) {
        return { state, action: Action.noop };
      }

      if (event.name === "idle" && !event.url.startsWith(getGameHomeUrl())) {
        return { state: States.initialize() };
      }

      const sightData = (event.name === "idle" ? event.state : undefined) as SightLike | undefined;
      const screen = sightData?.screen ?? "unknown";

      if (screen === "title") {
        return {
          state: { type: "idle", phase: "act" },
          action: Action.clickByElementId("btn-start"),
        };
      }
      if (screen === "result") {
        // Enter free-talk window once per result screen, then wait / retry.
        const freeTalkUntil = state.freeTalkUntil ?? nowMs + resolveFreeTalkMs();
        if (nowMs < freeTalkUntil) {
          return {
            state: { type: "idle", phase: "freeTalk", freeTalkUntil },
            action: Action.noop,
          };
        }
        return {
          state: { type: "idle", phase: "act", freeTalkUntil: undefined },
          action: Action.clickByElementId("btn-retry"),
        };
      }

      return {
        state: { type: "idle", phase: "act", freeTalkUntil: undefined },
        action: pickPlayAction(),
      };
    }
    case "freeTalk": {
      if (event === undefined) {
        return { state, action: Action.noop };
      }

      if (event.name === "idle" && !event.url.startsWith(getGameHomeUrl())) {
        return { state: States.initialize() };
      }

      const sightData = (event.name === "idle" ? event.state : undefined) as SightLike | undefined;
      const screen = sightData?.screen ?? "unknown";

      // Left result unexpectedly — resume normal play loop.
      if (screen !== "result") {
        return { state: { type: "idle", phase: "sight", freeTalkUntil: undefined } };
      }

      const freeTalkUntil = state.freeTalkUntil ?? nowMs + resolveFreeTalkMs();
      if (nowMs < freeTalkUntil) {
        return {
          state: { type: "idle", phase: "freeTalk", freeTalkUntil },
          action: Action.noop,
        };
      }

      return {
        state: { type: "idle", phase: "act", freeTalkUntil: undefined },
        action: Action.clickByElementId("btn-retry"),
      };
    }
    case "act": {
      if (event === undefined) {
        return { state, action: Action.noop };
      }
      // After an action (success or fail), sight again (preserve freeTalkUntil only if set).
      return {
        state: {
          type: "idle",
          phase: "sight",
          freeTalkUntil: state.freeTalkUntil,
        },
      };
    }
  }
}

export function* handleIdle(
  state: Extract<GameState, { type: "idle" }>,
): Generator<Action.Action, GameState, State> {
  let s: Extract<GameState, { type: "idle" }> = {
    type: "idle",
    phase: state.phase ?? "sight",
    freeTalkUntil: state.freeTalkUntil,
  };
  let event: State | undefined;

  for (;;) {
    const out = stepIdle(s, event);
    if (out.state.type !== "idle") {
      return out.state;
    }
    s = out.state;
    if (!out.action) {
      return s;
    }
    event = yield out.action;
  }
}

export function* handleClosed(
  state: Extract<GameState, { type: "closed" }>,
): Generator<Action.Action, GameState, State> {
  return state;
}

const machine = {
  initialize: { run: handleInitialize },
  idle: { run: handleIdle },
  closed: { run: handleClosed },
} as const satisfies {
  [K in GameState["type"]]: {
    run: (
      state: Extract<GameState, { type: K }>,
    ) => Generator<Action.Action, GameState, State>
  }
};

export function* solver(
  state: GameState | SolverStart = { type: "initialize" },
  _eventListeners: Partial<SolverEventListeners> = {},
): Generator<Action.Action, undefined, State> {
  let current = hydrate(state);
  while (current.type !== "closed") {
    current = yield* machine[current.type].run(current as never);
  }
}
