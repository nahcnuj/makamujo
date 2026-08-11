/**
 * In-process harness: real solver + stub game state machine (no Chromium).
 * Covers open → start → play keys → free-talk → retry → play again.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { Action } from "automated-gameplay-transmitter";
import { getGameHomeUrl } from "./server";
import { solver } from "./solver";

type Screen = "title" | "playing" | "result";

type StubGame = {
  screen: Screen;
  score: number;
  level: number;
  drops: number;
  opened: boolean;
};

const createStub = (): StubGame => ({
  screen: "title",
  score: 0,
  level: 1,
  drops: 0,
  opened: false,
});

const sightOf = (game: StubGame, url: string) => ({
  screen: game.screen,
  score: game.score,
  level: game.level,
  scoreText: `Score: ${game.score}`,
  levelText: `Level: ${game.level}`,
  url,
  title: "落ち物パズルゲーム・蘇 (stub)",
  selectedText: "",
  timestamp: Date.now(),
});

const applyToStub = (game: StubGame, action: Action.Action, home: string): boolean => {
  switch (action.name) {
    case "noop":
      return true;
    case "open":
      if (!action.url.startsWith(home)) return false;
      game.opened = true;
      game.screen = "title";
      return true;
    case "click": {
      if (action.target.type !== "id") return false;
      if (action.target.id === "btn-start") {
        if (game.screen !== "title") return false;
        game.screen = "playing";
        game.score = 0;
        game.drops = 0;
        return true;
      }
      if (action.target.id === "btn-retry") {
        if (game.screen !== "result") return false;
        game.screen = "playing";
        game.score = 0;
        game.drops = 0;
        return true;
      }
      return false;
    }
    case "press": {
      if (game.screen !== "playing") return false;
      if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(action.key)) {
        return false;
      }
      game.drops += 1;
      game.score = game.drops * 10;
      if (game.drops >= 3) {
        game.screen = "result";
      }
      return true;
    }
    default:
      return false;
  }
};

afterEach(() => {
  delete process.env.VIGILANT_FIESTA_HOME_URL;
  delete process.env.VIGILANT_FIESTA_FREE_TALK_MS;
});

describe("vigilant-fiesta play-loop harness (solver + stub game)", () => {
  it("starts, plays, free-talks after game over, retries, and plays again", () => {
    process.env.VIGILANT_FIESTA_HOME_URL = "http://stub.local/vigilant-fiesta/";
    process.env.VIGILANT_FIESTA_FREE_TALK_MS = "1000";
    const home = getGameHomeUrl();

    let fakeNow = 5_000_000;
    const realNow = Date.now;
    Date.now = () => fakeNow;

    try {
      const game = createStub();
      const gen = solver({ type: "initialize" });

      let event: any = undefined;
      let sawOpen = false;
      let sawStart = false;
      let sawPress = false;
      let sawResult = false;
      let sawRetry = false;
      let playedAfterRetry = false;
      let pressesAfterRetry = 0;

      for (let i = 0; i < 80; i++) {
        const next = event === undefined ? gen.next() : gen.next(event);
        if (next.done) break;
        const action = next.value as Action.Action;

        if (action.name === "open") sawOpen = true;
        if (action.name === "click" && action.target.type === "id" && action.target.id === "btn-start") {
          sawStart = true;
        }
        if (action.name === "press") {
          sawPress = true;
          if (sawRetry) pressesAfterRetry += 1;
        }
        if (action.name === "click" && action.target.type === "id" && action.target.id === "btn-retry") {
          sawRetry = true;
        }

        if (action.name === "noop") {
          // Advance wall clock a bit during free-talk so the window can elapse.
          if (game.screen === "result") {
            sawResult = true;
            fakeNow += 400;
          }
          event = {
            name: "idle",
            url: home,
            state: sightOf(game, home),
          };
          if (sawRetry && pressesAfterRetry >= 1 && sawPress && sawStart) {
            playedAfterRetry = true;
            break;
          }
          continue;
        }

        const ok = applyToStub(game, action, home);
        event = { name: "result", succeeded: ok, action };
      }

      expect(sawOpen).toBe(true);
      expect(sawStart).toBe(true);
      expect(sawPress).toBe(true);
      expect(sawResult).toBe(true);
      expect(sawRetry).toBe(true);
      expect(playedAfterRetry).toBe(true);
      expect(game.opened).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("re-opens when stub reports a foreign URL during play", () => {
    process.env.VIGILANT_FIESTA_HOME_URL = "http://stub.local/vigilant-fiesta/";
    const home = getGameHomeUrl();
    const gen = solver({ type: "initialize" });

    // open + start to reach idle loop
    let r = gen.next();
    expect(r.value).toMatchObject({ name: "open" });
    r = gen.next({ name: "result", succeeded: true, action: r.value } as any);
    expect(r.value).toMatchObject({ name: "click" });
    r = gen.next({ name: "result", succeeded: true, action: r.value } as any);
    // noop sight
    expect(r.value).toMatchObject({ name: "noop" });
    r = gen.next({
      name: "idle",
      url: "https://evil.example/",
      state: { screen: "playing", score: 0, level: 1 },
    } as any);
    // should re-open home
    expect(r.value).toEqual({ name: "open", url: home });
  });
});
