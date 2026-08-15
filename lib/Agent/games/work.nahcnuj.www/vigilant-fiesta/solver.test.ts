import { afterEach, describe, expect, it } from "bun:test";
import { Action } from "automated-gameplay-transmitter";
import { DEFAULT_GAME_HOME_URL, getGameHomeUrl } from "./server";
import {
  DEFAULT_FREE_TALK_MS,
  FREE_TALK_MS,
  resolveFreeTalkMs,
  States,
  solver,
  stepIdle,
  stepInitialize,
} from "./solver";

afterEach(() => {
  delete process.env.VIGILANT_FIESTA_HOME_URL;
  delete process.env.VIGILANT_FIESTA_FREE_TALK_MS;
});

const ok = (action: Action.Action) => ({
  name: "result" as const,
  succeeded: true,
  action,
});

const idleAt = (screen: string, extra: Record<string, unknown> = {}) => ({
  name: "idle" as const,
  url: getGameHomeUrl(),
  state: { screen, score: 0, level: 1, ...extra },
});

describe("resolveFreeTalkMs / getGameHomeUrl", () => {
  it("defaults free-talk to 30s", () => {
    expect(resolveFreeTalkMs()).toBe(DEFAULT_FREE_TALK_MS);
    expect(FREE_TALK_MS).toBe(DEFAULT_FREE_TALK_MS);
  });

  it("reads free-talk override from env", () => {
    process.env.VIGILANT_FIESTA_FREE_TALK_MS = "1234";
    expect(resolveFreeTalkMs()).toBe(1234);
  });

  it("falls back on invalid free-talk env", () => {
    process.env.VIGILANT_FIESTA_FREE_TALK_MS = "nope";
    expect(resolveFreeTalkMs()).toBe(DEFAULT_FREE_TALK_MS);
  });

  it("reads home URL override from env", () => {
    process.env.VIGILANT_FIESTA_HOME_URL = "http://127.0.0.1:9/game/";
    expect(getGameHomeUrl()).toBe("http://127.0.0.1:9/game/");
  });
});

describe("vigilant-fiesta stepInitialize", () => {
  it("opens the game URL first", () => {
    const out = stepInitialize(States.initialize(), undefined);
    expect(out.action).toEqual(Action.open(getGameHomeUrl()));
  });

  it("opens env-overridden home URL", () => {
    process.env.VIGILANT_FIESTA_HOME_URL = "http://fixture.test/";
    const out = stepInitialize(States.initialize(), undefined);
    expect(out.action).toEqual(Action.open("http://fixture.test/"));
  });

  it("clicks start after open succeeds", () => {
    const afterOpen = stepInitialize(
      States.initialize(),
      ok(Action.open(getGameHomeUrl())),
    );
    expect(afterOpen.state).toEqual({ type: "initialize", phase: "start" });

    const startClick = stepInitialize(
      { type: "initialize", phase: "start" },
      undefined,
    );
    expect(startClick.action).toEqual(Action.clickByElementId("btn-start"));
  });

  it("enters idle after start click result", () => {
    const out = stepInitialize(
      { type: "initialize", phase: "start" },
      ok(Action.clickByElementId("btn-start")),
    );
    expect(out.state).toEqual(States.idle());
  });

  it("closes when browser closes during initialize", () => {
    const out = stepInitialize(States.initialize(), { name: "closed" } as any);
    expect(out.state.type).toBe("closed");
  });
});

describe("vigilant-fiesta stepIdle", () => {
  it("reopens when navigated away", () => {
    const out = stepIdle(States.idle(), {
      name: "idle",
      url: "https://example.com/",
      state: { screen: "playing" },
    } as any);
    expect(out.state.type).toBe("initialize");
  });

  it("clicks start on title screen", () => {
    const out = stepIdle(
      { type: "idle", phase: "sight" },
      idleAt("title") as any,
    );
    expect(out.action).toEqual(Action.clickByElementId("btn-start"));
  });

  it("enters free-talk on result instead of immediate retry", () => {
    const now = 1_000_000;
    const out = stepIdle(
      { type: "idle", phase: "sight" },
      idleAt("result", { score: 12 }) as any,
      now,
    );
    expect(out.action).toEqual(Action.noop);
    expect(out.state).toEqual({
      type: "idle",
      phase: "freeTalk",
      freeTalkUntil: now + resolveFreeTalkMs(),
    });
  });

  it("uses short free-talk window from env", () => {
    process.env.VIGILANT_FIESTA_FREE_TALK_MS = "500";
    const now = 10_000;
    const out = stepIdle(
      { type: "idle", phase: "sight" },
      idleAt("result") as any,
      now,
    );
    expect(out.state).toMatchObject({
      phase: "freeTalk",
      freeTalkUntil: now + 500,
    });
  });

  it("keeps free-talk noops until the window ends", () => {
    const freeTalkUntil = 2_000_000;
    const out = stepIdle(
      { type: "idle", phase: "freeTalk", freeTalkUntil },
      idleAt("result", { score: 12 }) as any,
      freeTalkUntil - 1,
    );
    expect(out.action).toEqual(Action.noop);
    // Ensure the state is idle with freeTalk phase
    expect(out.state).toMatchObject({ type: "idle", phase: "freeTalk" });
  });

  it("clicks retry after free-talk window", () => {
    const freeTalkUntil = 2_000_000;
    const out = stepIdle(
      { type: "idle", phase: "freeTalk", freeTalkUntil },
      idleAt("result", { score: 12 }) as any,
      freeTalkUntil,
    );
    expect(out.action).toEqual(Action.clickByElementId("btn-retry"));
    expect(out.state).toEqual({
      type: "idle",
      phase: "act",
      freeTalkUntil: undefined,
    });
  });

  it("leaves freeTalk when result screen is gone", () => {
    const out = stepIdle(
      { type: "idle", phase: "freeTalk", freeTalkUntil: 9_999_999 },
      idleAt("playing") as any,
      0,
    );
    expect(out.state).toEqual({
      type: "idle",
      phase: "sight",
      freeTalkUntil: undefined,
    });
  });

  it("presses an arrow key while playing", () => {
    const out = stepIdle(
      { type: "idle", phase: "sight" },
      idleAt("playing") as any,
    );
    expect(out.action?.name).toBe("press");
    if (out.action?.name === "press") {
      expect(["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"]).toContain(
        out.action.key,
      );
    }
  });

  it("returns to sight after act", () => {
    const out = stepIdle(
      { type: "idle", phase: "act" },
      ok({ name: "press", key: "ArrowUp" }),
    );
    expect(out.state).toEqual({
      type: "idle",
      phase: "sight",
      freeTalkUntil: undefined,
    });
    expect(out.action).toBeUndefined();
  });
});

describe("vigilant-fiesta solver generator — full play cycle", () => {
  it("open → start → play keys → free-talk → retry → play again", () => {
    process.env.VIGILANT_FIESTA_FREE_TALK_MS = "1000";
    const home = DEFAULT_GAME_HOME_URL;

    let fakeNow = 1_000_000;
    const realNow = Date.now;
    Date.now = () => fakeNow;

    try {
      const gen = solver({ type: "initialize" });
      const actions: Action.Action[] = [];

      const step = (event?: any) => {
        const r = event === undefined ? gen.next() : gen.next(event);
        if (!r.done && r.value) actions.push(r.value as Action.Action);
        return r;
      };

      // open
      let r = step();
      expect(r.value).toEqual(Action.open(home));
      r = step(ok(Action.open(home)));

      // start
      expect(r.value).toEqual(Action.clickByElementId("btn-start"));
      r = step(ok(Action.clickByElementId("btn-start")));

      // first sight → title (safety) then start already done; playing
      // handleIdle starts with sight + event undefined → noop
      expect(r.value).toEqual(Action.noop);
      r = step(idleAt("playing", { score: 0, level: 1 }));
      expect(r.value?.name).toBe("press");
      const playKey = r.value as Action.Action;
      r = step(ok(playKey));

      // act → sight (no action from stepIdle act, handleIdle returns then re-enters)
      // After act without action, handleIdle returns; solver re-enters handleIdle
      // which starts with event undefined → noop
      expect(r.value).toEqual(Action.noop);
      r = step(idleAt("playing", { score: 10, level: 1 }));
      expect(r.value?.name).toBe("press");
      r = step(ok(r.value as Action.Action));

      // game over
      expect(r.value).toEqual(Action.noop);
      r = step(idleAt("result", { score: 30, level: 1 }));
      expect(r.value).toEqual(Action.noop); // freeTalk
      expect(
        actions.filter(
          (a) => a.name === "click" && (a as any).target?.id === "btn-retry",
        ),
      ).toHaveLength(0);

      // still free-talking
      r = step(idleAt("result", { score: 30, level: 1 }));
      expect(r.value).toEqual(Action.noop);

      // window elapsed
      fakeNow += 1000;
      r = step(idleAt("result", { score: 30, level: 1 }));
      expect(r.value).toEqual(Action.clickByElementId("btn-retry"));
      r = step(ok(Action.clickByElementId("btn-retry")));

      // after retry act → sight → playing again
      expect(r.value).toEqual(Action.noop);
      r = step(idleAt("playing", { score: 0, level: 1 }));
      expect(r.value?.name).toBe("press");

      // Must have: open, start, at least one press, retry
      expect(actions.some((a) => a.name === "open")).toBe(true);
      expect(
        actions.some(
          (a) => a.name === "click" && (a as any).target?.id === "btn-start",
        ),
      ).toBe(true);
      expect(actions.some((a) => a.name === "press")).toBe(true);
      expect(
        actions.some(
          (a) => a.name === "click" && (a as any).target?.id === "btn-retry",
        ),
      ).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("does not skip start when open fails then succeeds path stays on open", () => {
    const gen = solver({ type: "initialize" });
    const first = gen.next();
    expect(first.value).toEqual(Action.open(getGameHomeUrl()));
    const stay = gen.next({
      name: "result",
      succeeded: false,
      action: Action.open(getGameHomeUrl()),
    } as any);
    // failed open keeps initialize; may yield open again or same phase without action
    // stepInitialize open failure returns same phase open without advancing
    // handleInitialize: no action + event set + same phase → return state (stuck until outer re-run)
    // Actually looking at handleInitialize - if !out.action and event !== undefined && s.phase === prevPhase, return s
    // So generator ends handleInitialize with initialize open - outer while loops and re-enters handleInitialize
    // which starts with event undefined → open again
    expect(stay.done).toBe(false);
    if (!stay.done) {
      // re-entered initialize → open again
      expect(stay.value).toEqual(Action.open(getGameHomeUrl()));
    }
  });
});
