import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Action, type State } from "automated-gameplay-transmitter";
import { type GameName, ServerGames as Games } from "../Agent/games/server";
import { createReceiver } from "../Browser/socket";
import {
  buildSlotKey,
  emptyScoreRecords,
  emptyStoredHighscores,
  mergeRecordsIntoStored,
  parseStoredHighscores,
  recordsForSlot,
  type ScoreRecords,
  type StoredHighscores,
  serializeStoredHighscores,
  updateScoreRecords,
} from "../domain/games/VigilantFiestaRecords";
import { planVigilantFiestaSpeeches } from "../domain/games/VigilantFiestaSpeech";
import type { AgentSession } from "./AgentSession";
import type { SpeechPort, TalkModelPort } from "./types";

const VIGILANT_FIESTA_HIGHSCORE_PATH = "./var/vigilant-fiesta-highscore.json";

/**
 * Game IPC / solver loop over shared AgentSession.
 */
export class GameplayApplicationService {
  #session: AgentSession;
  #isSpeechable: () => boolean;
  #notifyGameStateChange: () => void;
  #speech: SpeechPort | undefined;
  #talkModel: TalkModelPort | undefined;
  #vigilantRecords: ScoreRecords | undefined;
  #vigilantStored: StoredHighscores | undefined;
  #vigilantSlotKey: string | undefined;
  #onGameSight?: (sightState: Record<string, unknown>) => void;

  constructor(
    session: AgentSession,
    isSpeechable: () => boolean,
    notifyGameStateChange: () => void,
    speech?: SpeechPort,
    talkModel?: TalkModelPort,
    onGameSight?: (sightState: Record<string, unknown>) => void,
  ) {
    this.#session = session;
    this.#isSpeechable = isSpeechable;
    this.#notifyGameStateChange = notifyGameStateChange;
    this.#speech = speech;
    this.#talkModel = talkModel;
    this.#onGameSight = onGameSight;
  }

  play(name: GameName, data?: string): void {
    if (name === "VigilantFiesta") {
      this.#reloadVigilantRecordsFromDisk();
    }

    const solver = Games[name].solver(
      {
        type: "initialize",
        data,
      },
      {
        onSave:
          name === "CookieClicker"
            ? [(text) => writeFileSync("./var/cookieclicker.txt", text)]
            : [],
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
            const enriched =
              name === "VigilantFiesta"
                ? this.#enrichVigilantState(nextState)
                : nextState;
            this.#session.playing = {
              name,
              state: {
                ...previousState,
                ...enriched,
              },
            };
            this.#reactToGameSight(name, previousState, nextState);
            this.#notifyGameStateChange();
            this.#onGameSight?.(nextState);
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

  #readStoredHighscores(): StoredHighscores {
    try {
      if (!existsSync(VIGILANT_FIESTA_HIGHSCORE_PATH)) {
        return emptyStoredHighscores();
      }
      return parseStoredHighscores(
        readFileSync(VIGILANT_FIESTA_HIGHSCORE_PATH, "utf-8"),
      );
    } catch {
      return emptyStoredHighscores();
    }
  }

  #currentSlotKey(): string | undefined {
    const meta = this.#session.streamState?.meta;
    return buildSlotKey({
      url: meta?.url ?? this.#session.currentProgramUrl,
      start: meta?.start,
    });
  }

  /** Load 通算 + 同枠の枠内 best (if stream meta is known). */
  #reloadVigilantRecordsFromDisk(): void {
    const stored = this.#readStoredHighscores();
    this.#vigilantStored = stored;
    this.#vigilantSlotKey = this.#currentSlotKey();
    this.#vigilantRecords = recordsForSlot(stored, this.#vigilantSlotKey);
  }

  /**
   * If the 配信枠 key became available or changed, re-bind sessionBest from disk
   * for that slot (so restarts show the same 枠内 record).
   */
  #syncVigilantSlotBinding(): void {
    const slotKey = this.#currentSlotKey();
    if (slotKey === this.#vigilantSlotKey) return;

    const stored = this.#vigilantStored ?? this.#readStoredHighscores();
    this.#vigilantStored = stored;
    this.#vigilantSlotKey = slotKey;

    const fromDisk = recordsForSlot(stored, slotKey);
    const current = this.#vigilantRecords ?? emptyScoreRecords();
    // Keep in-memory all-time; take the higher session best of disk vs memory
    // (memory may have scores before stream meta arrived).
    this.#vigilantRecords = {
      allTimeBest: Math.max(current.allTimeBest, fromDisk.allTimeBest),
      sessionBest: Math.max(current.sessionBest, fromDisk.sessionBest),
    };
  }

  #persistVigilantHighscores(): void {
    const records = this.#vigilantRecords;
    if (!records) return;
    const stored = this.#vigilantStored ?? emptyStoredHighscores();
    const slotKey = this.#vigilantSlotKey ?? this.#currentSlotKey();
    const next = mergeRecordsIntoStored(stored, records, slotKey);
    if (next === stored) return;
    this.#vigilantStored = next;
    try {
      mkdirSync(dirname(VIGILANT_FIESTA_HIGHSCORE_PATH), { recursive: true });
      writeFileSync(
        VIGILANT_FIESTA_HIGHSCORE_PATH,
        serializeStoredHighscores(next, slotKey),
      );
    } catch (err) {
      console.warn(
        "[WARN] failed to persist vigilant-fiesta high score:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  #enrichVigilantState(
    nextState: Record<string, unknown>,
  ): Record<string, unknown> {
    this.#syncVigilantSlotBinding();
    const current = this.#vigilantRecords ?? emptyScoreRecords();
    const updated = updateScoreRecords(current, nextState.score);
    if (updated !== current) {
      this.#vigilantRecords = updated;
      this.#persistVigilantHighscores();
    }
    const records = this.#vigilantRecords ?? updated;
    return {
      ...nextState,
      sessionBest: records.sessionBest,
      allTimeBest: records.allTimeBest,
    };
  }

  /**
   * Emit scripted commentary (and learn lines) from game sight diffs.
   * Free-style Markov continues via idle speech timer during free-talk windows.
   */
  #reactToGameSight(
    name: GameName,
    previousState: Record<string, unknown>,
    nextState: Record<string, unknown>,
  ): void {
    if (!this.#speech) return;

    const speeches =
      name === "VigilantFiesta"
        ? planVigilantFiestaSpeeches(previousState, nextState)
        : [];

    for (const text of speeches) {
      if (!text) continue;
      this.#talkModel?.learn(`${text}`);
      void this.#speech.speech(text);
    }
  }

  get Component() {
    if (this.#session.playing === undefined) return () => null;
    return Games[this.#session.playing.name].Component;
  }
}
