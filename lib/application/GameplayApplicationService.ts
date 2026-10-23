import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Action, type State } from "automated-gameplay-transmitter";
import { type GameName, ServerGames as Games } from "../Agent/games/server";
import { createReceiver as createSocketReceiver } from "../Browser/socket";
import {
  type GameActivityState,
  initialGameActivityState,
  observeGameActivity,
  resolveGameActivityTimeoutMs,
} from "../domain/games/GameActivityPolicy";
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
import type { SpeechPort } from "./types";

const VIGILANT_FIESTA_HIGHSCORE_PATH = "./var/vigilant-fiesta-highscore.json";

/**
 * ブラウザ IPC の受信器。差し替え口（テスト用）。
 *
 * 既定は unix ソケットの受信器（`lib/Browser/socket.ts`）。テストでは受け取った
 * `solve` を直接呼んで、ブラウザセッションからの状態を流し込む。
 */
export type GameStateReceiver = (
  solve: (state: State) => Action.Action,
) => void | Promise<void>;

/**
 * Game IPC / solver loop over shared AgentSession.
 */
export class GameplayApplicationService {
  #session: AgentSession;
  #isSpeechable: () => boolean;
  #notifyGameStateChange: () => void;
  #speech: SpeechPort | undefined;
  #vigilantRecords: ScoreRecords | undefined;
  #vigilantStored: StoredHighscores | undefined;
  #vigilantSlotKey: string | undefined;
  #onGameSight?: (sightState: Record<string, unknown>) => void;
  #createReceiver: GameStateReceiver;

  constructor(
    session: AgentSession,
    isSpeechable: () => boolean,
    notifyGameStateChange: () => void,
    speech?: SpeechPort,
    onGameSight?: (sightState: Record<string, unknown>) => void,
    createReceiver: GameStateReceiver = createSocketReceiver,
  ) {
    this.#session = session;
    this.#isSpeechable = isSpeechable;
    this.#notifyGameStateChange = notifyGameStateChange;
    this.#speech = speech;
    this.#onGameSight = onGameSight;
    this.#createReceiver = createReceiver;
  }

  play(name: GameName, data?: string): void {
    if (name === "VigilantFiesta") {
      this.#reloadVigilantRecordsFromDisk();
    }

    // Rebuilt whenever the round stops progressing so the next sight re-opens
    // the game and clicks start (see `observeGameActivity`).
    const createSolver = () =>
      Games[name].solver(
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
    let solver = createSolver();
    let activity: GameActivityState = initialGameActivityState();
    const activityTimeoutMs = resolveGameActivityTimeoutMs();
    try {
      this.#createReceiver((state: State) => {
        this.#session.browserState = state;
        console.debug(
          "[DEBUG]",
          "receiver got state",
          JSON.stringify(state, null, 0),
        );

        if (state.name === "closed") {
          this.#session.playing = undefined;
          activity = initialGameActivityState();
          this.#notifyGameStateChange();
          return Action.noop;
        }

        if (state.name === "initialized") {
          this.#session.playing = undefined;
          activity = initialGameActivityState();
          this.#notifyGameStateChange();
          // ブラウザセッションが（再）接続した。
          //
          // セッションは再起動するたびに開いていたページを失う
          // （bin/x/browser.ts の自動再起動、停止監視からのセッション終了、
          // 合成出力の凍結.watchdog による makamujo-browser.service の
          // 再起動）。そのままソルバを使い回すと "initialized" は通常の
          // sight として扱われ、鍵を押すだけになってゲームは戻らない:
          // 表示は空のまま、配信映像は静止したままになる（issue #993）。
          //
          // なので毎回ラウンドを最初から開き直す。ソルバを作り直した直後の
          // 最初の action は "open"（game の home URL）: ジェネレータは最初
          // の next() ではイベントを捨てて最初の action を返すので、開き
          // 直しの入口は必ず "open" になる。
          solver = createSolver();
          const { done, value } = solver.next(state);
          if (done) {
            this.#session.playing = undefined;
            this.#notifyGameStateChange();
            return Action.noop;
          }
          console.debug(
            "[DEBUG]",
            "browser session (re)connected; reopening the round",
            JSON.stringify(value, null, 0),
          );
          return value;
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
            // SILENT/ACTIVE: eyes still update session above; mouth only when active
            // (hands continue like Cookie Clicker)
            const active = this.#isSpeechable();
            if (active) {
              this.#reactToGameSight(name, previousState, nextState);
              this.#onGameSight?.(nextState);
            }
            this.#notifyGameStateChange();
          }

          // A round that never reaches the playing screen again is invisible
          // to the session watchdogs (the page keeps answering and painting),
          // so restart it here, where the open/start sequence lives. Only
          // VigilantFiesta reports a screen, so only it can be judged this way.
          if (name === "VigilantFiesta") {
            const sightScreen =
              state.state !== null && typeof state.state === "object"
                ? (state.state as { screen?: unknown }).screen
                : undefined;
            const decision = observeGameActivity(
              activity,
              { playing: sightScreen === "playing", nowMs: Date.now() },
              activityTimeoutMs,
            );
            activity = decision.state;
            if (decision.restart) {
              console.warn(
                "[WARN] game stayed off the playing screen; restarting the round",
              );
              this.#session.playing = undefined;
              activity = initialGameActivityState();
              this.#notifyGameStateChange();
              solver = createSolver();
            }
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
   * Emit scripted commentary from game sight diffs (ACTIVE / speechable only).
   * Free-style Markov continues via idle speech timer during free-talk windows.
   */
  #reactToGameSight(
    name: GameName,
    previousState: Record<string, unknown>,
    nextState: Record<string, unknown>,
  ): void {
    if (!this.#speech || !this.#isSpeechable()) return;

    const speeches =
      name === "VigilantFiesta"
        ? planVigilantFiestaSpeeches(previousState, nextState)
        : [];

    for (const text of speeches) {
      if (!text) continue;
      // Fixed scripts (milestones / game-over) — speak only; do not train Markov
      // (same as ad / cruise / stream-end system speeches)
      void this.#speech.speech(text);
    }
  }

  get Component() {
    if (this.#session.playing === undefined) return () => null;
    return Games[this.#session.playing.name].Component;
  }
}
