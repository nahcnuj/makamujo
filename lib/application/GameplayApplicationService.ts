import { writeFileSync } from "node:fs";
import { Action, type State } from "automated-gameplay-transmitter";
import { type GameName, ServerGames as Games } from "../Agent/games/server";
import { createReceiver } from "../Browser/socket";
import type { AgentSession } from "./AgentSession";

/**
 * Game IPC / solver loop over shared AgentSession.
 */
export class GameplayApplicationService {
  #session: AgentSession;
  #isSpeechable: () => boolean;
  #notifyGameStateChange: () => void;

  constructor(
    session: AgentSession,
    isSpeechable: () => boolean,
    notifyGameStateChange: () => void,
  ) {
    this.#session = session;
    this.#isSpeechable = isSpeechable;
    this.#notifyGameStateChange = notifyGameStateChange;
  }

  play(name: GameName, data?: string): void {
    const solver = Games[name].solver(
      {
        type: "initialize",
        data,
      },
      {
        onSave: [(text) => writeFileSync("./var/cookieclicker.txt", text)],
        isSilent: () => !this.#isSpeechable(),
      },
    );
    try {
      createReceiver((state: State) => {
        this.#session.browserState = state;
        console.debug(
          "[DEBUG]",
          "receiver got state",
          JSON.stringify(state, null, 0),
        );

        if (state.name === "closed") {
          this.#session.playing = undefined;
          this.#notifyGameStateChange();
          return Action.noop;
        }

        if (state.name === "idle") {
          if (state.state) {
            const previousState = this.#session.playing?.state ?? {};
            const nextState =
              state.state !== null && typeof state.state === "object"
                ? (state.state as Record<string, unknown>)
                : {};
            this.#session.playing = {
              name,
              state: {
                ...previousState,
                ...nextState,
              },
            };
            this.#notifyGameStateChange();
          }
        }

        const { done, value } = solver.next(state);
        if (done) {
          this.#session.playing = undefined;
          this.#notifyGameStateChange();
          return Action.noop;
        }
        console.debug("[DEBUG]", "next action", JSON.stringify(value, null, 0));
        console.debug(
          "[DEBUG]",
          "sending action",
          JSON.stringify(value, null, 0),
        );

        return value;
      });
    } catch (err) {
      console.warn(
        "[WARN]",
        "failed to start IPC receiver, continuing without browser IPC:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  get Component() {
    if (this.#session.playing === undefined) return () => null;
    return Games[this.#session.playing.name].Component;
  }
}
