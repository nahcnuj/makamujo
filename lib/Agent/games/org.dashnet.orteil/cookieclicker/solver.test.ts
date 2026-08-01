import { Action, ActionResult } from "automated-gameplay-transmitter";
import { beforeAll, describe, expect, it } from "bun:test";
import {
  solver,
  IDLE_CLICKS_BEFORE_SAVE,
  States,
  hydrate,
  handleSeeStats,
  stepSeeStats,
  handleSave,
  stepSave,
  stepIdle,
  stepInitialize,
  handleIdle,
  handleInitialize,
  handleClosed,
  type HandlerCtx,
  type GameState,
  runActions,
} from "./solver";
import type { Action as ActionType } from "automated-gameplay-transmitter";

beforeAll(() => {
  console.debug = () => { };
  console.error = () => { };
});

const expectOk = (solve: Generator, action: any) => expect(solve.next(ActionResult.ok(action)).value);

describe('solver', () => {
  it('should initialize', () => {
    const solve = solver();

    expect(solve.next().value).toHaveProperty('name', 'open');

    const actions = [
      Action.clickByText('日本語'),
      Action.clickByText('Got it'),
      Action.clickByText('次回から表示しない'),
    ];

    let prev;
    for (const action of actions) {
      expectOk(solve, prev).toEqual(action);
      prev = action;
    }
  });

  it('should initialize with existing data', () => {
    const data = 'Mi4wNTJ8fDE3NjM4ODAzNTI5MTQ7MTc2Mzg4MDM1MjkxNDsxNzYzODgwMzYyNTE1O1RyaXBsZSBHbm9tZTt5dnJjZjswLDEsMCwwLDAsMCwwfDExMTExMTAxMTAwMTAxMTAwMTAxMDExMDAwMXwwOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzswOzA7MDswOzA7MDswOy0xOy0xOy0xOy0xOy0xOzA7MDswOzA7NzU7MDswOy0xOy0xOzE3NjM4ODAzNTI5MTQ7MDswOzs0MTswOzA7MDs1MDswOzA7fDAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7MCwwLDAsMCwsMCwwOzAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7MCwwLDAsMCwsMCwwOzAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7MCwwLDAsMCwsMCwwOzAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7MCwwLDAsMCwsMCwwOzAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7MCwwLDAsMCwsMCwwOzAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7MCwwLDAsMCwsMCwwOzAsMCwwLDAsLDAsMDswLDAsMCwwLCwwLDA7fDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDB8MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMHx8%21END%21';
    const solve = solver({
      type: 'initialize',
      phase: 'open',
      data,
    });

    expect(solve.next().value).toHaveProperty('name', 'open');

    const actions = [
      Action.clickByText('日本語'),
      Action.clickByText('Got it'),
      Action.clickByText('次回から表示しない'),
      { name: 'press', key: 'Control+O' },
      { name: 'fill', value: data, on: { selector: '#game', role: 'textbox' } },
      { name: 'press', key: 'Enter' },
    ];

    let prev;
    for (const action of actions) {
      expectOk(solve, prev).toEqual(action);
      prev = action;
    }
  });

  it('should continue initialization when optional steps fail', () => {
    const solve = solver();

    expect(solve.next().value).toHaveProperty('name', 'open');

    // open succeeds
    expect(solve.next(ActionResult.ok(undefined as any)).value).toEqual(Action.clickByText('日本語'));

    // optional steps fail (e.g. dialogs not present) — initialization should continue
    expect(solve.next(ActionResult.error(Action.clickByText('日本語')) as any).value).toEqual(Action.clickByText('Got it'));
    expect(solve.next(ActionResult.error(Action.clickByText('Got it')) as any).value).toEqual(Action.clickByText('次回から表示しない'));
  });

  it('should be done when got closed state', () => {
    const solve = solver({ type: 'closed' });
    expect(solve.next().done).toBeTrue();
  });

  it('should click a random clickable element in the idle state', () => {
    const idleState = {
      name: 'idle' as const,
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: ['bigCookie'] },
    };

    const solve = solver({ type: 'idle', phase: 'sight', count: 0 });

    expect(solve.next().value).toEqual(Action.noop);
    expect(solve.next(idleState as any).value).toEqual(Action.clickByElementId('bigCookie'));
  });

  it('should click one of the available clickable elements', () => {
    const idleState = {
      name: 'idle' as const,
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: ['bigCookie', 'shimmer1', 'shimmer2'] },
    };

    const solve = solver({ type: 'idle', phase: 'sight', count: 0 });

    expect(solve.next().value).toEqual(Action.noop);
    const clickAction = solve.next(idleState as any).value as any;
    expect(clickAction).toHaveProperty('name', 'click');
    expect(['bigCookie', 'shimmer1', 'shimmer2']).toContain(clickAction.target.id);
  });

  it('should fall back to clicking bigCookie when no clickable elements in state', () => {
    const idleState = {
      name: 'idle' as const,
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: [] },
    };

    const solve = solver({ type: 'idle', phase: 'sight', count: 0 });

    expect(solve.next().value).toEqual(Action.noop);
    expect(solve.next(idleState as any).value).toEqual(Action.clickByElementId('bigCookie'));
  });

  it('should click bigCookie only when isSilent returns true, even if other elements are available', () => {
    const idleState = {
      name: 'idle' as const,
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: ['bigCookie', 'shimmer1', 'shimmer2'] },
    };

    const solve = solver({ type: 'idle', phase: 'sight', count: 0 }, { isSilent: () => true });

    expect(solve.next().value).toEqual(Action.noop);
    expect(solve.next(idleState as any).value).toEqual(Action.clickByElementId('bigCookie'));
  });

  it('should click a random element when isSilent returns false', () => {
    const idleState = {
      name: 'idle' as const,
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: ['bigCookie', 'shimmer1', 'shimmer2'] },
    };

    const solve = solver({ type: 'idle', phase: 'sight', count: 0 }, { isSilent: () => false });

    expect(solve.next().value).toEqual(Action.noop);
    const clickAction = solve.next(idleState as any).value as any;
    expect(clickAction).toHaveProperty('name', 'click');
    expect(['bigCookie', 'shimmer1', 'shimmer2']).toContain(clickAction.target.id);
  });

  it('should restart from initialize when navigated to another page', () => {
    const wrongUrlState = {
      name: 'idle' as const,
      url: 'https://example.com/',
    };
    const openAction = Action.open('https://orteil.dashnet.org/cookieclicker/');

    const solve = solver({ type: 'idle', phase: 'sight', count: 0 });

    expect(solve.next().value).toEqual(Action.noop);
    // When at wrong URL, transition to initialize state and open Cookie Clicker
    expect(solve.next(wrongUrlState as any).value).toEqual(openAction);
    // After opening, should proceed with initialization steps (not idle clicking)
    expect(solve.next(ActionResult.ok(openAction) as any).value).toEqual(Action.clickByText('日本語'));
  });

  it('should press ESC after a click fails in the idle state', () => {
    const idleState = {
      name: 'idle' as const,
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: ['bigCookie'] },
    };
    const clickAction = Action.clickByElementId('bigCookie');

    const solve = solver({ type: 'idle', phase: 'sight', count: 0 });

    expect(solve.next().value).toEqual(Action.noop);
    expect(solve.next(idleState as any).value).toEqual(clickAction);
    expect(solve.next(ActionResult.error(clickAction) as any).value).toEqual({ name: 'press', key: 'Escape' });
  });

  it('should press ESC after the first click in save sequence fails', () => {
    const optionsAction = Action.clickByText('オプション');

    const solve = solver({ type: 'save', phase: 'options', failureCount: 0 });

    expect(solve.next().value).toEqual(optionsAction);
    expect(solve.next(ActionResult.error(optionsAction) as any).value).toEqual({ name: 'press', key: 'Escape' });
  });

  it('should press ESC after the second click in save sequence fails', () => {
    const optionsAction = Action.clickByText('オプション');
    const exportAction = Action.clickByText('セーブをエクスポート');

    const solve = solver({ type: 'save', phase: 'options', failureCount: 0 });

    expect(solve.next().value).toEqual(optionsAction);
    expect(solve.next(ActionResult.ok(optionsAction) as any).value).toEqual(exportAction);
    expect(solve.next(ActionResult.error(exportAction) as any).value).toEqual({ name: 'press', key: 'Escape' });
  });

  it('should set closed state when browser closes during ESC press after a click fails', () => {
    const idleState = {
      name: 'idle' as const,
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: ['bigCookie'] },
    };
    const clickAction = Action.clickByElementId('bigCookie');

    const solve = solver({ type: 'idle', phase: 'sight', count: 0 });

    expect(solve.next().value).toEqual(Action.noop);
    expect(solve.next(idleState as any).value).toEqual(clickAction);
    expect(solve.next(ActionResult.error(clickAction) as any).value).toEqual({ name: 'press', key: 'Escape' });
    expect(solve.next({ name: 'closed' } as any).done).toBeTrue();
  });

  it('should return to idle after consecutive failures in save state', () => {
    const optionsAction = Action.clickByText('オプション');
    const escapeAction = { name: 'press', key: 'Escape' } as const;

    const solve = solver({ type: 'save', phase: 'options', failureCount: 0 });

    // First failure: failureCount 0 → 1, stays in save
    expect(solve.next().value).toEqual(optionsAction);
    expect(solve.next(ActionResult.error(optionsAction) as any).value).toEqual(escapeAction);
    expect(solve.next(ActionResult.ok(escapeAction as any) as any).value).toEqual(optionsAction);

    // Second failure: failureCount 1 → 2, stays in save
    expect(solve.next(ActionResult.error(optionsAction) as any).value).toEqual(escapeAction);
    expect(solve.next(ActionResult.ok(escapeAction as any) as any).value).toEqual(optionsAction);

    // Third failure: failureCount 2 → 3 >= MAX_CONSECUTIVE_FAILURES → transitions to idle
    expect(solve.next(ActionResult.error(optionsAction) as any).value).toEqual(escapeAction);
    expect(solve.next(ActionResult.ok(escapeAction as any) as any).value).toEqual(Action.noop);
  });

  it('should return to idle after consecutive failures in seeStats state', () => {
    const statsAction = Action.clickByText('記録');
    const escapeAction = { name: 'press', key: 'Escape' } as const;

    const solve = solver({ type: 'seeStats', phase: 'open', failureCount: 0 });

    // First failure: failureCount 0 → 1, stays in seeStats
    expect(solve.next().value).toEqual(statsAction);
    expect(solve.next(ActionResult.error(statsAction) as any).value).toEqual(escapeAction);
    expect(solve.next(ActionResult.ok(escapeAction as any) as any).value).toEqual(statsAction);

    // Second failure: failureCount 1 → 2, stays in seeStats
    expect(solve.next(ActionResult.error(statsAction) as any).value).toEqual(escapeAction);
    expect(solve.next(ActionResult.ok(escapeAction as any) as any).value).toEqual(statsAction);

    // Third failure: failureCount 2 → 3 >= MAX_CONSECUTIVE_FAILURES → transitions to idle
    expect(solve.next(ActionResult.error(statsAction) as any).value).toEqual(escapeAction);
    expect(solve.next(ActionResult.ok(escapeAction as any) as any).value).toEqual(Action.noop);
  });
  it('seeStats opens the stats menu then sights', () => {
    const solve = solver({ type: 'seeStats', phase: 'open', failureCount: 0 });
    const stats = Action.clickByText('記録');

    expect(solve.next().value).toEqual(stats);
    expect(solve.next(ActionResult.ok(stats) as any).value).toEqual(Action.noop);
  });

  it('save exports save data then dismisses the dialog', () => {
    const solve = solver({ type: 'save', phase: 'options', failureCount: 0 });
    const options = Action.clickByText('オプション');
    const exportSave = Action.clickByText('セーブをエクスポート');
    const escape = { name: 'press', key: 'Escape' } as const;

    expect(solve.next().value).toEqual(options);
    expect(solve.next(ActionResult.ok(options) as any).value).toEqual(exportSave);
    expect(solve.next(ActionResult.ok(exportSave) as any).value).toEqual(Action.noop);
    expect(
      solve.next({
        name: 'idle',
        url: 'https://orteil.dashnet.org/cookieclicker/',
        selectedText: 'SAVE_DATA',
      } as any).value,
    ).toEqual(escape);
  });

  it('idle starts save after enough clicks', () => {
    const idleState = {
      name: 'idle' as const,
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: ['bigCookie'] },
    };
    const click = Action.clickByElementId('bigCookie');
    const solve = solver({ type: 'idle', phase: 'sight', count: 0 });

    // Black-box safety bound only: if save never starts by then, treat as broken.
    const maxClicks = 1_000_000;
    let action: unknown = solve.next().value;

    for (let i = 0; i < maxClicks; i++) {
      expect(action).toEqual(Action.noop);
      expect(solve.next(idleState as any).value).toEqual(click);
      action = solve.next(ActionResult.ok(click) as any).value;

      const a = action as { name?: string; target?: { text?: string } };
      if (a?.name === 'click' && a.target?.text === 'オプション') {
        return;
      }
    }
    throw new Error(`did not enter save within ${maxClicks} clicks`);
  });
});


function* testRunActions(
  actions: readonly ActionType.Action[],
): Generator<ActionType.Action, boolean, unknown> {
  for (const action of actions) {
    const result = yield action;
    if ((result as { name?: string } | undefined)?.name === "closed") {
      return false;
    }
    if (
      action.name !== "noop" &&
      (result as { name?: string })?.name === "result" &&
      (result as { succeeded?: boolean })?.succeeded === false
    ) {
      yield { name: "press", key: "Escape" } as ActionType.Action;
      return false;
    }
  }
  return true;
}

function baseCtx(overrides: Partial<HandlerCtx> = {}): HandlerCtx {
  return {
    listeners: { onSave: [], isSilent: () => false },
    getGameData: () => undefined,
    setGameData: () => {},
    getHasReloadedForShoten: () => false,
    setHasReloadedForShoten: () => {},
    runActions: testRunActions as HandlerCtx["runActions"],
    ...overrides,
  };
}

function drive(
  gen: Generator<ActionType.Action, GameState, unknown>,
  replies: unknown[],
): { actions: ActionType.Action[]; state: GameState } {
  const actions: ActionType.Action[] = [];
  let step = gen.next();
  let i = 0;
  while (!step.done) {
    actions.push(step.value);
    step = gen.next(replies[i++]);
  }
  return { actions, state: step.value };
}

describe("handleSeeStats", () => {
  it("opens stats, sights, then returns idle", () => {
    const gen = handleSeeStats({ type: "seeStats", phase: "open", failureCount: 0 }, baseCtx());
    const { actions, state } = drive(gen, [
      ActionResult.ok(Action.clickByText("記録")),
      ActionResult.ok(Action.noop),
    ]);
    expect(actions[0]).toEqual(Action.clickByText("記録"));
    expect(actions[1]).toEqual(Action.noop);
    expect(state).toEqual({ type: "idle", phase: "sight", count: 0 });
  });

  it("bumps failureCount when 記録 fails", () => {
    const gen = handleSeeStats({ type: "seeStats", phase: "open", failureCount: 0 }, baseCtx());
    const { actions, state } = drive(gen, [
      ActionResult.error(Action.clickByText("記録")),
      ActionResult.ok({ name: "press", key: "Escape" } as any),
    ]);
    expect(actions[0]).toEqual(Action.clickByText("記録"));
    expect(actions[1]).toEqual({ name: "press", key: "Escape" });
    expect(state).toEqual({ type: "seeStats", phase: "open", failureCount: 1 });
  });
});

describe("handleSave", () => {
  it("exports save, notifies onSave, then enters seeStats", () => {
    const saved: string[] = [];
    const ctx = baseCtx({
      listeners: {
        onSave: [(t) => saved.push(t)],
        isSilent: () => false,
      },
      setGameData: () => {},
    });
    const gen = handleSave({ type: "save", phase: "options", failureCount: 0 }, ctx);
    const options = Action.clickByText("オプション");
    const exportSave = Action.clickByText("セーブをエクスポート");
    const { actions, state } = drive(gen, [
      ActionResult.ok(options),
      ActionResult.ok(exportSave),
      {
        name: "idle",
        url: "https://orteil.dashnet.org/cookieclicker/",
        selectedText: "SAVE_BLOB",
      },
      ActionResult.ok({ name: "press", key: "Escape" } as any),
    ]);
    expect(actions[0]).toEqual(options);
    expect(actions[1]).toEqual(exportSave);
    expect(actions[2]).toEqual(Action.noop);
    expect(actions[3]).toEqual({ name: "press", key: "Escape" });
    expect(saved).toEqual(["SAVE_BLOB"]);
    expect(state).toEqual({ type: "seeStats", phase: "open", failureCount: 0 });
  });
});

describe('stepSeeStats', () => {
  it('open with no event requests 記録', () => {
    const out = stepSeeStats(States.seeStats(), undefined);
    expect(out.action).toEqual(Action.clickByText('記録'));
    expect(out.state).toMatchObject({ type: 'seeStats', phase: 'open' });
  });

  it('open success moves to sight with noop', () => {
    const out = stepSeeStats(
      States.seeStats(),
      ActionResult.ok(Action.clickByText('記録')) as any,
    );
    expect(out.action).toEqual(Action.noop);
    expect(out.state).toMatchObject({ type: 'seeStats', phase: 'sight' });
  });

  it('open failure moves to escape', () => {
    const out = stepSeeStats(
      States.seeStats(),
      ActionResult.error(Action.clickByText('記録')) as any,
    );
    expect(out.action).toEqual({ name: 'press', key: 'Escape' });
    expect(out.state).toMatchObject({ type: 'seeStats', phase: 'escape' });
  });

  it('sight after noop goes idle', () => {
    const out = stepSeeStats(
      { type: 'seeStats', phase: 'sight', failureCount: 0 },
      ActionResult.ok(Action.noop) as any,
    );
    expect(out.state).toMatchObject({ type: 'idle' });
  });

  it('closed event closes', () => {
    const out = stepSeeStats(States.seeStats(), { name: 'closed' } as any);
    expect(out.state).toEqual({ type: 'closed' });
  });
});

describe('stepSave', () => {
  const ctx = {
    listeners: { onSave: [] as Array<(t: string) => void>, isSilent: () => false },
    setGameData: (_: string | undefined) => {},
  };

  it('options with no event requests オプション', () => {
    const out = stepSave(States.save(), undefined, ctx);
    expect(out.action).toEqual(Action.clickByText('オプション'));
  });

  it('options success moves to export', () => {
    const out = stepSave(
      States.save(),
      ActionResult.ok(Action.clickByText('オプション')) as any,
      ctx,
    );
    expect(out.action).toEqual(Action.clickByText('セーブをエクスポート'));
    expect(out.state).toMatchObject({ phase: 'export' });
  });

  it('read with selectedText notifies onSave and escapes', () => {
    const saved: string[] = [];
    const out = stepSave(
      { type: 'save', phase: 'read', failureCount: 0 },
      {
        name: 'idle',
        url: 'https://orteil.dashnet.org/cookieclicker/',
        selectedText: 'BLOB',
      } as any,
      {
        listeners: { onSave: [(t) => saved.push(t)], isSilent: () => false },
        setGameData: () => {},
      },
    );
    expect(saved).toEqual(['BLOB']);
    expect(out.action).toEqual({ name: 'press', key: 'Escape' });
    expect(out.state).toMatchObject({ phase: 'escape' });
  });

  it('escape success goes to seeStats', () => {
    const out = stepSave(
      { type: 'save', phase: 'escape', failureCount: 0 },
      ActionResult.ok({ name: 'press', key: 'Escape' } as any) as any,
      ctx,
    );
    expect(out.state).toMatchObject({ type: 'seeStats' });
  });
});

describe('stepIdle', () => {
  function idleCtx(overrides: Partial<HandlerCtx> = {}): HandlerCtx {
    return {
      listeners: { onSave: [], isSilent: () => false },
      getGameData: () => undefined,
      setGameData: () => {},
      getHasReloadedForShoten: () => false,
      setHasReloadedForShoten: () => {},
      runActions: function* () { return true; } as any,
      ...overrides,
    };
  }

  it('sight with no event requests noop', () => {
    const out = stepIdle(States.idle(), undefined, idleCtx());
    expect(out.action).toEqual(Action.noop);
  });

  it('sight on foreign origin re-initializes', () => {
    const out = stepIdle(
      States.idle(),
      { name: 'idle', url: 'https://example.com/' } as any,
      idleCtx({ getGameData: () => 'X' }),
    );
    expect(out.state).toMatchObject({ type: 'initialize', data: 'X' });
  });

  it('click success below threshold stays idle', () => {
    const out = stepIdle(
      { type: 'idle', phase: 'click', count: 0 },
      ActionResult.ok(Action.clickByElementId('bigCookie')) as any,
      idleCtx(),
    );
    expect(out.state).toMatchObject({ type: 'idle', count: 1 });
  });

  it('click success at threshold enters save', () => {
    const out = stepIdle(
      { type: 'idle', phase: 'click', count: IDLE_CLICKS_BEFORE_SAVE },
      ActionResult.ok(Action.clickByElementId('bigCookie')) as any,
      idleCtx(),
    );
    expect(out.state).toMatchObject({ type: 'save' });
  });
});

describe('stepInitialize', () => {
  it('open with no event opens the game', () => {
    const out = stepInitialize(States.initialize(), undefined);
    expect(out.action).toHaveProperty('name', 'open');
  });

  it('open success moves to lang', () => {
    const out = stepInitialize(
      States.initialize(),
      ActionResult.ok(Action.open('https://orteil.dashnet.org/cookieclicker/')) as any,
    );
    expect(out.state).toMatchObject({ type: 'initialize', phase: 'lang' });
  });

  it('dontShow without data finishes to seeStats', () => {
    const out = stepInitialize(
      { type: 'initialize', phase: 'dontShow' },
      ActionResult.ok(Action.clickByText('次回から表示しない')) as any,
    );
    expect(out.state).toMatchObject({ type: 'seeStats' });
  });

  it('dontShow with data moves to importKey', () => {
    const out = stepInitialize(
      { type: 'initialize', phase: 'dontShow', data: 'SAVE' },
      ActionResult.ok(Action.clickByText('次回から表示しない')) as any,
    );
    expect(out.state).toMatchObject({ phase: 'importKey' });
  });
});

describe('step* remaining branches', () => {
  const saveCtx = {
    listeners: { onSave: [] as Array<(t: string) => void>, isSilent: () => false },
    setGameData: (_: string | undefined) => {},
  };

  function idleCtx(overrides: Partial<HandlerCtx> = {}): HandlerCtx {
    return {
      listeners: { onSave: [], isSilent: () => false },
      getGameData: () => undefined,
      setGameData: () => {},
      getHasReloadedForShoten: () => false,
      setHasReloadedForShoten: () => {},
      runActions: function* () { return true; } as any,
      ...overrides,
    };
  }

  it('stepSeeStats escape after fail bumps failureCount', () => {
    const out = stepSeeStats(
      { type: 'seeStats', phase: 'escape', failureCount: 0 },
      ActionResult.ok({ name: 'press', key: 'Escape' } as any) as any,
    );
    expect(out.state).toMatchObject({ type: 'seeStats', phase: 'open', failureCount: 1 });
  });

  it('stepSave options failure moves to failEscape', () => {
    const out = stepSave(
      States.save(),
      ActionResult.error(Action.clickByText('オプション')) as any,
      saveCtx,
    );
    expect(out.state).toMatchObject({ phase: 'failEscape' });
    expect(out.action).toEqual({ name: 'press', key: 'Escape' });
  });

  it('stepSave failEscape bumps failureCount', () => {
    const out = stepSave(
      { type: 'save', phase: 'failEscape', failureCount: 0 },
      ActionResult.ok({ name: 'press', key: 'Escape' } as any) as any,
      saveCtx,
    );
    expect(out.state).toMatchObject({ type: 'save', phase: 'options', failureCount: 1 });
  });

  it('stepSave export success moves to read', () => {
    const out = stepSave(
      { type: 'save', phase: 'export', failureCount: 0 },
      ActionResult.ok(Action.clickByText('セーブをエクスポート')) as any,
      saveCtx,
    );
    expect(out.state).toMatchObject({ phase: 'read' });
    expect(out.action).toEqual(Action.noop);
  });

  it('stepIdle silent ascending re-initializes', () => {
    let marked = false;
    const out = stepIdle(
      States.idle(),
      {
        name: 'idle',
        url: 'https://orteil.dashnet.org/cookieclicker/',
        state: { title: '昇天中', clickableElementIds: ['bigCookie'] },
      } as any,
      idleCtx({
        listeners: { onSave: [], isSilent: () => true },
        getHasReloadedForShoten: () => false,
        setHasReloadedForShoten: () => { marked = true; },
      }),
    );
    expect(marked).toBeTrue();
    expect(out.state).toMatchObject({ type: 'initialize' });
  });

  it('stepIdle click failure moves to failEscape', () => {
    const out = stepIdle(
      { type: 'idle', phase: 'click', count: 3 },
      ActionResult.error(Action.clickByElementId('bigCookie')) as any,
      idleCtx(),
    );
    expect(out.state).toMatchObject({ phase: 'failEscape' });
    expect(out.action).toEqual({ name: 'press', key: 'Escape' });
  });

  it('stepIdle failEscape returns to sight', () => {
    const out = stepIdle(
      { type: 'idle', phase: 'failEscape', count: 3 },
      ActionResult.ok({ name: 'press', key: 'Escape' } as any) as any,
      idleCtx(),
    );
    expect(out.state).toMatchObject({ type: 'idle', phase: 'sight', count: 3 });
  });

  it('stepInitialize lang advances to gotIt', () => {
    const out = stepInitialize(
      { type: 'initialize', phase: 'lang' },
      ActionResult.ok(Action.clickByText('日本語')) as any,
    );
    expect(out.state).toMatchObject({ phase: 'gotIt' });
  });

  it('stepInitialize importKey starts fill path', () => {
    const out = stepInitialize(
      { type: 'initialize', phase: 'importKey', data: 'SAVE' },
      undefined,
    );
    expect(out.action).toEqual({ name: 'press', key: 'Control+O' });
  });

  it('stepInitialize importEnter success goes to seeStats', () => {
    const out = stepInitialize(
      { type: 'initialize', phase: 'importEnter', data: 'SAVE' },
      ActionResult.ok({ name: 'press', key: 'Enter' } as any) as any,
    );
    expect(out.state).toMatchObject({ type: 'seeStats' });
  });

  it('hydrate fills default phases', () => {
    
    expect(hydrate({ type: 'initialize' } as any)).toMatchObject({ phase: 'open' });
    expect(hydrate({ type: 'idle', count: 2 })).toMatchObject({ phase: 'sight', count: 2 });
    expect(hydrate({ type: 'save', failureCount: 1 })).toMatchObject({ phase: 'options' });
    expect(hydrate({ type: 'seeStats', failureCount: 0 })).toMatchObject({ phase: 'open' });
    expect(hydrate({ type: 'closed' })).toEqual({ type: 'closed' });
  });
});

describe('States factories and thin handles', () => {
  it('States helpers return hydrated shapes', () => {
    expect(States.initialize('D')).toMatchObject({ type: 'initialize', phase: 'open', data: 'D' });
    expect(States.idle(5)).toMatchObject({ type: 'idle', phase: 'sight', count: 5 });
    expect(States.save(2)).toMatchObject({ type: 'save', phase: 'options', failureCount: 2 });
    expect(States.seeStats(1)).toMatchObject({ type: 'seeStats', phase: 'open', failureCount: 1 });
    expect(States.closed()).toEqual({ type: 'closed' });
  });

  it('handleClosed returns closed', () => {
    const gen = handleClosed({ type: 'closed' }, {
      listeners: { onSave: [], isSilent: () => false },
      getGameData: () => undefined,
      setGameData: () => {},
      getHasReloadedForShoten: () => false,
      setHasReloadedForShoten: () => {},
      runActions: function* () { return true; } as any,
    });
    const step = gen.next();
    expect(step.done).toBeTrue();
    expect(step.value).toEqual({ type: 'closed' });
  });


  it('handleIdle one successful click stays idle', () => {
    const ctx = {
      listeners: { onSave: [], isSilent: () => false },
      getGameData: () => undefined,
      setGameData: () => {},
      getHasReloadedForShoten: () => false,
      setHasReloadedForShoten: () => {},
      runActions: function* () { return true; } as any,
    };
    const gen = handleIdle(States.idle(0), ctx as any);
    let s = gen.next();
    expect(s.value).toEqual(Action.noop);
    s = gen.next({
      name: 'idle',
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: ['bigCookie'] },
    } as any);
    // click action
    expect(s.done).toBeFalse();
    s = gen.next(ActionResult.ok(s.value as any) as any);
    expect(s.done).toBeTrue();
    expect(s.value).toMatchObject({ type: 'idle', count: 1 });
  });
  it('handleInitialize reaches seeStats on happy path', () => {
    const gen = handleInitialize(States.initialize(), {
      listeners: { onSave: [], isSilent: () => false },
      getGameData: () => undefined,
      setGameData: () => {},
      getHasReloadedForShoten: () => false,
      setHasReloadedForShoten: () => {},
      runActions: function* () { return true; } as any,
    });
    // open
    let s = gen.next();
    expect(s.value).toHaveProperty('name', 'open');
    s = gen.next(ActionResult.ok(s.value as any) as any);
    // lang, gotIt, dontShow
    for (const _ of [0, 1, 2]) {
      if (s.done) break;
      s = gen.next(ActionResult.ok(s.value as any) as any);
    }
    // may still be yielding dialogs — drain until done
    let guard = 0;
    while (!s.done && guard++ < 20) {
      s = gen.next(ActionResult.ok(s.value as any) as any);
    }
    expect(s.done).toBeTrue();
    expect(s.value).toMatchObject({ type: 'seeStats' });
  });
});

describe('failure ceiling and runActions edges', () => {
  it('bumpFailureCount reaches idle after enough seeStats failures', () => {
    // failureCount 2 + 1 → idle (MAX_CONSECUTIVE_FAILURES = 3)
    const out = stepSeeStats(
      { type: 'seeStats', phase: 'escape', failureCount: 2 },
      ActionResult.ok({ name: 'press', key: 'Escape' } as any) as any,
    );
    expect(out.state).toMatchObject({ type: 'idle' });
  });

  it('bumpFailureCount reaches idle after enough save failures', () => {
    const out = stepSave(
      { type: 'save', phase: 'failEscape', failureCount: 2 },
      ActionResult.ok({ name: 'press', key: 'Escape' } as any) as any,
      {
        listeners: { onSave: [], isSilent: () => false },
        setGameData: () => {},
      },
    );
    expect(out.state).toMatchObject({ type: 'idle' });
  });

  it('runActions warns on unexpected result then continues', () => {
    const solve = solver(States.idle(0));
    expect(solve.next().value).toEqual(Action.noop);
    const click = solve.next({
      name: 'idle',
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: ['bigCookie'] },
    } as any).value;
    // non-result, non-closed reply to a click — hits unexpected branch inside runActions
    const next = solve.next({ name: 'idle', url: 'https://orteil.dashnet.org/cookieclicker/' } as any);
    expect(next.done === true || next.value != null).toBeTrue();
  });
});

describe('obvious step* branches', () => {
  const saveCtx = {
    listeners: { onSave: [] as Array<(t: string) => void>, isSilent: () => false },
    setGameData: (_: string | undefined) => {},
  };

  function idleCtx(overrides: Partial<HandlerCtx> = {}): HandlerCtx {
    return {
      listeners: { onSave: [], isSilent: () => false },
      getGameData: () => undefined,
      setGameData: () => {},
      getHasReloadedForShoten: () => false,
      setHasReloadedForShoten: () => {},
      runActions: function* () { return true; } as any,
      ...overrides,
    };
  }

  it('stepInitialize closed event', () => {
    expect(stepInitialize(States.initialize(), { name: 'closed' } as any).state)
      .toEqual({ type: 'closed' });
  });

  it('stepSave closed event', () => {
    expect(stepSave(States.save(), { name: 'closed' } as any, saveCtx).state)
      .toEqual({ type: 'closed' });
  });

  it('stepInitialize open failure stays on open', () => {
    const open = Action.open('https://orteil.dashnet.org/cookieclicker/');
    const out = stepInitialize(States.initialize(), ActionResult.error(open) as any);
    expect(out.state).toMatchObject({ type: 'initialize', phase: 'open' });
    expect(out.action).toBeUndefined();
  });

  it('stepInitialize importEnter failure stays', () => {
    const out = stepInitialize(
      { type: 'initialize', phase: 'importEnter', data: 'SAVE' },
      ActionResult.error({ name: 'press', key: 'Enter' } as any) as any,
    );
    expect(out.state).toMatchObject({ phase: 'importEnter' });
  });

  it('stepSave export with no event requests export click', () => {
    const out = stepSave(
      { type: 'save', phase: 'export', failureCount: 0 },
      undefined,
      saveCtx,
    );
    expect(out.action).toEqual(Action.clickByText('セーブをエクスポート'));
  });

  it('stepSave read with no event requests noop', () => {
    const out = stepSave(
      { type: 'save', phase: 'read', failureCount: 0 },
      undefined,
      saveCtx,
    );
    expect(out.action).toEqual(Action.noop);
  });

  it('stepSave escape with no event requests Escape', () => {
    const out = stepSave(
      { type: 'save', phase: 'escape', failureCount: 0 },
      undefined,
      saveCtx,
    );
    expect(out.action).toEqual({ name: 'press', key: 'Escape' });
  });

  it('stepSave escape failure calls afterFail', () => {
    const out = stepSave(
      { type: 'save', phase: 'escape', failureCount: 0 },
      ActionResult.error({ name: 'press', key: 'Escape' } as any) as any,
      saveCtx,
    );
    expect(out.state).toMatchObject({ type: 'save', phase: 'options', failureCount: 1 });
  });

  it('stepIdle click with no event clicks bigCookie', () => {
    const out = stepIdle(
      { type: 'idle', phase: 'click', count: 0 },
      undefined,
      idleCtx(),
    );
    expect(out.action).toEqual(Action.clickByElementId('bigCookie'));
  });

  it('stepSeeStats sight with no event requests noop', () => {
    const out = stepSeeStats(
      { type: 'seeStats', phase: 'sight', failureCount: 0 },
      undefined,
    );
    expect(out.action).toEqual(Action.noop);
  });

  it('runActions closed on Escape after click failure', () => {
    const solve = solver(States.idle(0));
    expect(solve.next().value).toEqual(Action.noop);
    const click = solve.next({
      name: 'idle',
      url: 'https://orteil.dashnet.org/cookieclicker/',
      state: { clickableElementIds: ['bigCookie'] },
    } as any).value;
    expect(solve.next(ActionResult.error(click as any) as any).value)
      .toEqual({ name: 'press', key: 'Escape' });
    const done = solve.next({ name: 'closed' } as any);
    expect(done.done).toBeTrue();
  });
});

describe('runActions', () => {
  it('returns true when all actions succeed', () => {
    const action = Action.clickByText('x');
    const gen = runActions([action]);
    let s = gen.next();
    expect(s.value).toEqual(action);
    s = gen.next(ActionResult.ok(action) as any);
    expect(s.done).toBeTrue();
    expect(s.value).toBe(true);
  });

  it('returns false on closed and invokes onClosed', () => {
    let closed = false;
    const action = Action.clickByText('x');
    const gen = runActions([action], () => { closed = true; });
    gen.next();
    const s = gen.next({ name: 'closed' } as any);
    expect(s.done).toBeTrue();
    expect(s.value).toBe(false);
    expect(closed).toBeTrue();
  });

  it('yields Escape on failure then returns false', () => {
    const action = Action.clickByText('x');
    const gen = runActions([action]);
    let s = gen.next();
    s = gen.next(ActionResult.error(action) as any);
    expect(s.value).toEqual({ name: 'press', key: 'Escape' });
    s = gen.next(ActionResult.ok({ name: 'press', key: 'Escape' } as any) as any);
    expect(s.done).toBeTrue();
    expect(s.value).toBe(false);
  });

  it('onClosed when Escape is closed after failure', () => {
    let closed = false;
    const action = Action.clickByText('x');
    const gen = runActions([action], () => { closed = true; });
    gen.next();
    let s = gen.next(ActionResult.error(action) as any);
    expect(s.value).toEqual({ name: 'press', key: 'Escape' });
    s = gen.next({ name: 'closed' } as any);
    expect(s.value).toBe(false);
    expect(closed).toBeTrue();
  });

  it('skips success check for noop', () => {
    const gen = runActions([Action.noop]);
    let s = gen.next();
    expect(s.value).toEqual(Action.noop);
    s = gen.next({ name: 'idle', url: 'https://example.com/' } as any);
    expect(s.done).toBeTrue();
    expect(s.value).toBe(true);
  });
});

describe('step* invalid phase', () => {
  const saveCtx = {
    listeners: { onSave: [] as Array<(t: string) => void>, isSilent: () => false },
    setGameData: (_: string | undefined) => {},
  };

  it('stepSeeStats throws on unknown phase', () => {
    expect(() =>
      stepSeeStats(
        { type: 'seeStats', phase: 'nope' as any, failureCount: 0 },
        undefined,
      ),
    ).toThrow();
  });

  it('stepSave throws on unknown phase', () => {
    expect(() =>
      stepSave(
        { type: 'save', phase: 'nope' as any, failureCount: 0 },
        undefined,
        saveCtx,
      ),
    ).toThrow();
  });
});

describe("remaining stepInitialize branches", () => {
  it("importKey failure stays", () => {
    const out = stepInitialize(
      { type: "initialize", phase: "importKey", data: "SAVE" },
      ActionResult.error({ name: "press", key: "Control+O" } as any) as any,
    );
    expect(out.state).toMatchObject({ phase: "importKey" });
    expect(out.action).toBeUndefined();
  });

  it("importFill failure stays", () => {
    const out = stepInitialize(
      { type: "initialize", phase: "importFill", data: "SAVE" },
      ActionResult.error({
        name: "fill",
        value: "SAVE",
        on: { selector: "#game", role: "textbox" },
      } as any) as any,
    );
    expect(out.state).toMatchObject({ phase: "importFill" });
    expect(out.action).toBeUndefined();
  });
});
describe("handleInitialize terminal open failure", () => {
  it("stops when open fails", () => {
    const gen = handleInitialize(States.initialize(), {
      listeners: { onSave: [], isSilent: () => false },
      getGameData: () => undefined,
      setGameData: () => {},
      getHasReloadedForShoten: () => false,
      setHasReloadedForShoten: () => {},
      runActions: function* () { return true; } as any,
    } as any);
    let s = gen.next();
    expect(s.value).toHaveProperty("name", "open");
    s = gen.next(ActionResult.error(s.value as any) as any);
    expect(s.done).toBeTrue();
    expect(s.value).toMatchObject({ type: "initialize", phase: "open" });
  });
});
describe("runActions unexpected result branch", () => {
  it("warns on unexpected non-result reply", () => {
    const action = Action.clickByText("x");
    const gen = runActions([action]);
    let s = gen.next();
    expect(s.value).toEqual(action);
    // not result / not closed — hits console.warn branch then continues
    s = gen.next({ name: "idle", url: "https://example.com/" } as any);
    expect(s.done).toBeTrue();
    expect(s.value).toBe(true);
  });
});