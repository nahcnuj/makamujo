import { describe, expect, it } from "bun:test";
import type { Action, State } from "automated-gameplay-transmitter";
import { getGameHomeUrl } from "../Agent/games/work.nahcnuj.www/vigilant-fiesta/server";
import { AgentSession } from "./AgentSession";
import { GameplayApplicationService } from "./GameplayApplicationService";

type Solve = (state: State) => Action.Action;

/**
 * ブラウザ IPC を受け取るだけのハーネス。`solve` はブラウザセッションから
 * 届く状態をそのまま流し込む口。
 */
const createHarness = () => {
  const session = new AgentSession();
  let solve: Solve | undefined;
  const service = new GameplayApplicationService(
    session,
    () => true,
    () => undefined,
    undefined,
    undefined,
    (receive) => {
      solve = receive;
    },
  );
  service.play("VigilantFiesta");
  if (solve === undefined) {
    throw new Error("the browser receiver was not created");
  }
  return { session, solve };
};

const openAction = { name: "open", url: getGameHomeUrl() } as const;

describe("GameplayApplicationService browser session restarts", () => {
  it("opens the game when the browser session connects", () => {
    const { solve } = createHarness();
    expect(solve({ name: "initialized" })).toEqual(openAction);
  });

  it("re-opens the game when the browser session restarts mid-round", () => {
    const { solve } = createHarness();

    // The session connects: the game is opened.
    const opened = solve({ name: "initialized" });
    expect(opened).toEqual(openAction);

    // The page opened: the round starts.
    const started = solve({ name: "result", succeeded: true, action: opened });
    expect(started).toEqual({
      name: "click",
      target: { type: "id", id: "btn-start" },
    });

    // The round is playing: the solver presses keys.
    solve({ name: "result", succeeded: true, action: started });
    const playing = solve({
      name: "idle",
      url: getGameHomeUrl(),
      state: { screen: "playing", score: 0, level: 1 },
    });
    expect(playing.name).toBe("press");

    // The browser session restarted: the page it had open is gone, so the
    // round has to be opened again instead of pressing keys on an empty
    // page (issue #993).
    expect(solve({ name: "initialized" })).toEqual(openAction);
  });

  it("re-opens the game when the browser session restarts after closing", () => {
    const { solve } = createHarness();
    solve({ name: "initialized" });

    expect(solve({ name: "closed" })).toEqual({ name: "noop" });
    expect(solve({ name: "initialized" })).toEqual(openAction);
  });

  it("keeps the round going after the browser session restarted", () => {
    const { solve } = createHarness();

    // A session restart re-opens the game...
    solve({ name: "initialized" });
    const opened = solve({ name: "initialized" });
    expect(opened).toEqual(openAction);

    // ...and the re-opened page is started again, so the round continues
    // instead of leaving the display blank.
    const started = solve({ name: "result", succeeded: true, action: opened });
    expect(started).toEqual({
      name: "click",
      target: { type: "id", id: "btn-start" },
    });
  });
});
