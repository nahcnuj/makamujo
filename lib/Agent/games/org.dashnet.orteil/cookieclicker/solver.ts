// NOTE: this solver is specific to the makamujo application and is
// intentionally kept outside of the shared library.  It relies on
// `Action`/`State` types defined by `automated-gameplay-transmitter`, but
// the strategy logic here is unique to the AI agent's behaviour.
import { Action, type State } from "automated-gameplay-transmitter";

export type GameState =
  | {
      type: "initialize";
      phase?:
        | "open"
        | "lang"
        | "gotIt"
        | "dontShow"
        | "importKey"
        | "importFill"
        | "importEnter";
      data?: string;
    }
  | {
      type: "idle";
      phase?: "sight" | "click" | "failEscape";
      count: number;
    }
  | {
      type: "seeStats";
      phase?: "open" | "sight" | "escape";
      failureCount: number;
    }
  | {
      type: "save";
      phase?: "options" | "export" | "read" | "escape" | "failEscape";
      failureCount: number;
    }
  | { type: "closed" };

type SolverEventListeners = {
  onSave: Array<(text: string) => void>;
  isSilent: () => boolean;
};

const MAX_CONSECUTIVE_FAILURES = 3;

/** Clicks in idle before entering save. */

/** Public entry: callers (app / tests) need not know phase. */
export type SolverStart =
  | { type: "initialize"; data?: string }
  | { type: "closed" };

/** Factories for legal running states (phase filled in). Prefer these over raw literals. */
export const States = {
  initialize: (data?: string): Extract<GameState, { type: "initialize" }> => ({
    type: "initialize",
    phase: "open",
    data,
  }),
  idle: (count = 0): Extract<GameState, { type: "idle" }> => ({
    type: "idle",
    phase: "sight",
    count,
  }),
  save: (failureCount = 0): Extract<GameState, { type: "save" }> => ({
    type: "save",
    phase: "options",
    failureCount,
  }),
  seeStats: (failureCount = 0): Extract<GameState, { type: "seeStats" }> => ({
    type: "seeStats",
    phase: "open",
    failureCount,
  }),
  closed: (): Extract<GameState, { type: "closed" }> => ({ type: "closed" }),
};

/** Fill default phases so external callers can omit them. */
export function hydrate(state: GameState | SolverStart): GameState {
  switch (state.type) {
    case "initialize":
      return {
        type: "initialize",
        phase: "phase" in state && state.phase ? state.phase : "open",
        data: state.data,
      };
    case "idle":
      return {
        type: "idle",
        phase: "phase" in state && state.phase ? state.phase : "sight",
        count: "count" in state ? state.count : 0,
      };
    case "save":
      return {
        type: "save",
        phase: "phase" in state && state.phase ? state.phase : "options",
        failureCount: "failureCount" in state ? state.failureCount : 0,
      };
    case "seeStats":
      return {
        type: "seeStats",
        phase: "phase" in state && state.phase ? state.phase : "open",
        failureCount: "failureCount" in state ? state.failureCount : 0,
      };
    case "closed":
      return { type: "closed" };
  }
}
export const IDLE_CLICKS_BEFORE_SAVE = 1_000;

/** After boot, open Stats so stream UI can show generation / clicks. */
export function stateAfterInitialize(): GameState {
  return { type: "seeStats", phase: "open", failureCount: 0 };
}

/** After a successful idle click. */
export function stateAfterIdleClick(count: number): GameState {
  if (count >= IDLE_CLICKS_BEFORE_SAVE) {
    return { type: "save", phase: "options", failureCount: 0 };
  }
  return { type: "idle", phase: "sight", count: count + 1 };
}

/** After save sequence succeeds. */
export function stateAfterSaveSuccess(): GameState {
  return { type: "seeStats", phase: "open", failureCount: 0 };
}

/** After seeStats sequence succeeds. */
export function stateAfterSeeStatsSuccess(): GameState {
  return { type: "idle", phase: "sight", count: 0 };
}

/**
 * Increments the `failureCount` of the given state by one.
 * If the updated count reaches {@link MAX_CONSECUTIVE_FAILURES}, returns an `idle` state instead.
 */
function bumpFailureCount<T extends { failureCount: number }>(
  state: T,
): T | { type: "idle"; phase: "sight"; count: number } {
  const next = { ...state, failureCount: state.failureCount + 1 };
  if (next.failureCount >= MAX_CONSECUTIVE_FAILURES) {
    return { type: "idle", phase: "sight", count: 0 };
  }
  return next;
}

type RunActions = (
  actions: readonly Action.Action[],
) => Generator<Action.Action, boolean, State>;

export type HandlerCtx = {
  listeners: SolverEventListeners;
  getGameData: () => string | undefined;
  setGameData: (data: string | undefined) => void;
  getHasReloadedForShoten: () => boolean;
  setHasReloadedForShoten: (v: boolean) => void;
  runActions: RunActions;
  /** runActions が closed を検知したときに参照する（既存挙動維持） */
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
          action: Action.open("https://orteil.dashnet.org/cookieclicker/"),
        };
      }
      // open failed or succeeded — continue to optional dialogs (same as before for optional path)
      if (event.name === "result" && event.succeeded === false) {
        // open is required in old runActions — stay or still continue?
        // Old: runActions false → return state or closed. Treat fail as stop at initialize open.
        return { state: { ...state, phase: "open" } };
      }
      return { state: { ...state, phase: "lang" } };
    }
    case "lang": {
      if (event === undefined) {
        return { state, action: Action.clickByText("日本語") };
      }
      // optional: always advance
      return { state: { ...state, phase: "gotIt" } };
    }
    case "gotIt": {
      if (event === undefined) {
        return { state, action: Action.clickByText("Got it") };
      }
      return { state: { ...state, phase: "dontShow" } };
    }
    case "dontShow": {
      if (event === undefined) {
        return { state, action: Action.clickByText("次回から表示しない") };
      }
      if (state.data) {
        return { state: { ...state, phase: "importKey" } };
      }
      return { state: stateAfterInitialize() };
    }
    case "importKey": {
      if (event === undefined) {
        return { state, action: { name: "press", key: "Control+O" } };
      }
      if (event.name === "result" && event.succeeded === false) {
        return { state };
      }
      return { state: { ...state, phase: "importFill" } };
    }
    case "importFill": {
      if (event === undefined) {
        return {
          state,
          action: {
            name: "fill",
            value: state.data ?? "",
            on: { selector: "#game", role: "textbox" },
          },
        };
      }
      if (event.name === "result" && event.succeeded === false) {
        return { state };
      }
      return { state: { ...state, phase: "importEnter" } };
    }
    case "importEnter": {
      if (event === undefined) {
        return { state, action: { name: "press", key: "Enter" } };
      }
      if (event.name === "result" && event.succeeded === false) {
        return { state };
      }
      return { state: stateAfterInitialize() };
    }
  }
}

export function* handleInitialize(
  state: Extract<GameState, { type: "initialize" }>,
  _ctx: HandlerCtx,
): Generator<Action.Action, GameState, State> {
  let s: Extract<GameState, { type: "initialize" }> = {
    type: "initialize",
    phase: state.phase ?? "open",
    data: state.data,
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
      // Phase-only transition: keep going. Same phase after an event: stop.
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
  ctx: HandlerCtx,
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

      if (
        event.name === "idle" &&
        !event.url.startsWith("https://orteil.dashnet.org/cookieclicker/")
      ) {
        return {
          state: { type: "initialize", phase: "open", data: ctx.getGameData() },
        };
      }

      const sightData = event.name === "idle" ? event.state : undefined;

      if (!ctx.listeners.isSilent()) {
        ctx.setHasReloadedForShoten(false);
      } else if (
        (sightData as { title?: string } | undefined)?.title?.includes(
          "昇天中",
        ) &&
        !ctx.getHasReloadedForShoten()
      ) {
        ctx.setHasReloadedForShoten(true);
        return {
          state: { type: "initialize", phase: "open", data: ctx.getGameData() },
        };
      }

      const clickableElementIds = Array.isArray(
        (sightData as { clickableElementIds?: string[] } | undefined)
          ?.clickableElementIds,
      )
        ? (sightData as { clickableElementIds: string[] }).clickableElementIds
        : ["bigCookie"];
      const candidateIds = ctx.listeners.isSilent()
        ? ["bigCookie"]
        : clickableElementIds.length > 0
          ? clickableElementIds
          : ["bigCookie"];
      const targetId =
        candidateIds[Math.floor(Math.random() * candidateIds.length)]!;

      return {
        state: { type: "idle", phase: "click", count: state.count },
        action: Action.clickByElementId(targetId),
      };
    }
    case "click": {
      if (event === undefined) {
        return { state, action: Action.clickByElementId("bigCookie") };
      }
      if (event.name === "result" && event.succeeded === false) {
        return {
          state: { type: "idle", phase: "failEscape", count: state.count },
          action: { name: "press", key: "Escape" },
        };
      }
      return { state: stateAfterIdleClick(state.count) };
    }
    case "failEscape": {
      return { state: { type: "idle", phase: "sight", count: state.count } };
    }
  }
}

export function* handleIdle(
  state: Extract<GameState, { type: "idle" }>,
  ctx: HandlerCtx,
): Generator<Action.Action, GameState, State> {
  let s: Extract<GameState, { type: "idle" }> = {
    type: "idle",
    phase: state.phase ?? "sight",
    count: state.count,
  };
  let event: State | undefined;

  for (;;) {
    const out = stepIdle(s, event, ctx);
    if (out.state.type !== "idle") {
      return out.state;
    }
    s = out.state;
    if (!out.action) {
      return out.state;
    }
    event = yield out.action;
  }
}

export function stepSave(
  state: Extract<GameState, { type: "save" }>,
  event: State | undefined,
  ctx: Pick<HandlerCtx, "listeners" | "setGameData">,
): { state: GameState; action?: Action.Action } {
  if (event?.name === "closed") {
    return { state: { type: "closed" } };
  }

  const afterFail = (): GameState => {
    const next = bumpFailureCount({
      type: "save" as const,
      phase: "options" as const,
      failureCount: state.failureCount,
    });
    if ((next as GameState).type === "idle") {
      return { type: "idle", phase: "sight", count: 0 };
    }
    return {
      type: "save",
      phase: "options",
      failureCount: (next as { failureCount: number }).failureCount,
    };
  };

  const phase = state.phase ?? "options";
  switch (phase) {
    case "options": {
      if (event === undefined) {
        return { state, action: Action.clickByText("オプション") };
      }
      if (event.name === "result" && event.succeeded === false) {
        return {
          state: { ...state, phase: "failEscape" },
          action: { name: "press", key: "Escape" },
        };
      }
      return {
        state: { ...state, phase: "export" },
        action: Action.clickByText("セーブをエクスポート"),
      };
    }
    case "export": {
      if (event === undefined) {
        return { state, action: Action.clickByText("セーブをエクスポート") };
      }
      if (event.name === "result" && event.succeeded === false) {
        return {
          state: { ...state, phase: "failEscape" },
          action: { name: "press", key: "Escape" },
        };
      }
      return {
        state: { ...state, phase: "read" },
        action: Action.noop,
      };
    }
    case "read": {
      if (event === undefined) {
        return { state, action: Action.noop };
      }
      if (event.name === "idle" && event.selectedText) {
        const text = event.selectedText ?? "";
        ctx.setGameData(text);
        for (const f of ctx.listeners.onSave) {
          f(text);
        }
      }
      return {
        state: { ...state, phase: "escape" },
        action: { name: "press", key: "Escape" },
      };
    }
    case "escape": {
      if (event === undefined) {
        return { state, action: { name: "press", key: "Escape" } };
      }
      if (event.name === "result" && event.succeeded === false) {
        return { state: afterFail() };
      }
      return { state: stateAfterSaveSuccess() };
    }
    case "failEscape": {
      return { state: afterFail() };
    }
    default: {
      throw new Error(`unexpected save phase: ${String(phase)}`);
    }
  }
}

export function* handleSave(
  state: Extract<GameState, { type: "save" }>,
  ctx: HandlerCtx,
): Generator<Action.Action, GameState, State> {
  let s: Extract<GameState, { type: "save" }> = {
    type: "save",
    phase: state.phase ?? "options",
    failureCount: state.failureCount,
  };
  let event: State | undefined;

  for (;;) {
    const out = stepSave(s, event, ctx);
    if (out.state.type !== "save") {
      return out.state;
    }
    s = out.state;
    if (!out.action) {
      return out.state;
    }
    event = yield out.action;
  }
}

export function stepSeeStats(
  state: Extract<GameState, { type: "seeStats" }>,
  event: State | undefined,
): { state: GameState; action?: Action.Action } {
  if (event?.name === "closed") {
    return { state: { type: "closed" } };
  }

  const phase = state.phase ?? "options";
  switch (phase) {
    case "open": {
      if (event === undefined) {
        return { state, action: Action.clickByText("記録") };
      }
      if (event.name === "result" && event.succeeded === false) {
        return {
          state: { ...state, phase: "escape" },
          action: { name: "press", key: "Escape" },
        };
      }
      return {
        state: { ...state, phase: "sight" },
        action: Action.noop,
      };
    }
    case "escape": {
      const next = bumpFailureCount({
        type: "seeStats" as const,
        phase: "open" as const,
        failureCount: state.failureCount,
      });
      if ((next as GameState).type === "idle") {
        return { state: { type: "idle", phase: "sight", count: 0 } };
      }
      return {
        state: {
          type: "seeStats",
          phase: "open",
          failureCount: (next as { failureCount: number }).failureCount,
        },
      };
    }
    case "sight": {
      if (event === undefined) {
        return { state, action: Action.noop };
      }
      return { state: stateAfterSeeStatsSuccess() };
    }
    default: {
      throw new Error(`unexpected seeStats phase: ${String(phase)}`);
    }
  }
}

export function* handleSeeStats(
  state: Extract<GameState, { type: "seeStats" }>,
  _ctx: HandlerCtx,
): Generator<Action.Action, GameState, State> {
  let s: Extract<GameState, { type: "seeStats" }> = {
    type: "seeStats",
    phase: state.phase ?? "open",
    failureCount: state.failureCount,
  };
  let event: State | undefined;

  for (;;) {
    const out = stepSeeStats(s, event);
    if (out.state.type !== "seeStats") {
      return out.state;
    }
    s = out.state;
    // No action means this handle turn is finished (e.g. after failure recovery).
    if (!out.action) {
      return out.state;
    }
    event = yield out.action;
  }
}

/** Terminal state runner; signature matches other state handlers. */
// biome-ignore lint/correctness/useYield: closed state emits no actions
export function* handleClosed(
  state: Extract<GameState, { type: "closed" }>,
  _ctx: HandlerCtx,
): Generator<Action.Action, GameState, State> {
  return state;
}

/**
 * state.type → その state の runner。
 * GameState に type を足したら、ここにキーを足すまで型エラー。
 */
const machine = {
  initialize: { run: handleInitialize },
  idle: { run: handleIdle },
  save: { run: handleSave },
  seeStats: { run: handleSeeStats },
  closed: { run: handleClosed },
} as const satisfies {
  [K in GameState["type"]]: {
    run: (
      state: Extract<GameState, { type: K }>,
      ctx: HandlerCtx,
    ) => Generator<Action.Action, GameState, State>;
  };
};

/**
 * Shared action runner (module-level so coverage and tests can target it directly).
 * @returns true if all actions succeeded, false on failure or closed.
 */
export function* runActions(
  actions: readonly Action.Action[],
  onClosed: () => void = () => {},
): Generator<Action.Action, boolean, State> {
  for (const action of actions) {
    const result = yield action;
    if (result.name === "closed") {
      onClosed();
      return false;
    }
    if (action.name !== "noop") {
      if (result.name === "result") {
        if (!result.succeeded) {
          console.error(`failed to`, result.action);
          const escapeKeyPressResult = yield {
            name: "press",
            key: "Escape",
          } as const;
          if (escapeKeyPressResult.name === "closed") {
            onClosed();
          }
          return false;
        }
      } else {
        console.warn("unexpected result", result);
      }
    }
  }
  return true;
}
export function* solver(
  state: GameState | SolverStart = { type: "initialize" },
  eventListeners: Partial<SolverEventListeners> = {},
): Generator<Action.Action, undefined, State> {
  const listeners: SolverEventListeners = {
    onSave: [],
    isSilent: () => false,
    ...eventListeners,
  };

  state = hydrate(state);
  let hasReloadedForShoten = false;
  let gameData: string | undefined =
    state.type === "initialize" ? state.data : undefined;
  let _closed = false;

  function* runActionsBound(
    actions: readonly Action.Action[],
  ): Generator<Action.Action, boolean, State> {
    return yield* runActions(actions, () => {
      _closed = true;
    });
  }

  const ctx: HandlerCtx = {
    listeners,
    getGameData: () => gameData,
    setGameData: (data) => {
      gameData = data;
    },
    getHasReloadedForShoten: () => hasReloadedForShoten,
    setHasReloadedForShoten: (v) => {
      hasReloadedForShoten = v;
    },
    runActions: runActionsBound,
  };

  while (state.type !== "closed") {
    _closed = false;
    state = yield* machine[state.type].run(state as never, ctx);
  }
}
