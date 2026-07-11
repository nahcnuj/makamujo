import { Action, type AgentComment, type State } from "automated-gameplay-transmitter";
import { writeFileSync } from "node:fs";
import { SpeechQueue, type SpeechEvent } from "../application/SpeechQueue";
import { createReceiver } from "../Browser/socket";
import {
  initialNGramSize,
  initialNGramSizeRaw,
  inferNGramSize,
  inferNGramSizeRaw,
} from "../domain/broadcasting/NGramPolicy";
import {
  evaluateSpeechable,
  isCommentsStale,
  shouldPromptCommentAfterViewerIncrease,
} from "../domain/broadcasting/SilencePolicy";
import {
  COMMENT_PROMPT_TEXT,
  CRUISE_WELCOME_SPEECHES,
  extractAdName,
  formatAdThanks,
  formatGiftThanks,
  isAdCompletedComment,
  isCruiseQuoteStart,
  isStreamEndOneMinute,
  STREAM_END_SPEECHES,
} from "../domain/comments/SystemSpeechScripts";
import { pickTopic } from "../domain/comments/TopicPicker";
import { ServerGames as Games, type GameName } from "./games/server";
import type { AgentState } from "./State";

export const SILENCE_THRESHOLD_MS = 5 * 60 * 1_000; // 5 minutes

export class MakaMujo {
  #talkModel: TalkModel;
  #tts: TTS;
  #speechQueue: SpeechQueue;

  #browserState?: State;
  #playing?: {
    name: GameName;
    state: ReturnType<typeof Games[GameName]["sight"]>;
  };

  #streamState?: AgentState;

  #lastListenerCount?: number;
  #listenersStaleSince?: Date;
  #lastCommentAt?: Date;
  // The URL of the currently active program. Used to scope comment tracking.
  #currentProgramUrl?: string;
  // Latest comment number observed for the current program URL.
  #currentProgramLatestCommentNo = 0;
  #currentNGramSize = initialNGramSize();
  #currentNGramSizeRaw = initialNGramSizeRaw();
  #hasPromptedCommentForViewerIncrease = false;

  #gameStateChangeListeners: Array<() => void> = [];

  constructor(talkModel: TalkModel, tts: TTS) {
    this.#talkModel = talkModel;
    this.#tts = tts;
    this.#speechQueue = new SpeechQueue(tts);
  }

  play(name: GameName, data?: string) {
    const solver = Games[name].solver({
      type: "initialize",
      data,
    }, {
      onSave: [
        (text) => writeFileSync("./var/cookieclicker.txt", text),
      ],
      isSilent: () => !this.speechable,
    });
    try {
      createReceiver((state) => {
        this.#browserState = state;
        console.debug("[DEBUG]", "receiver got state", JSON.stringify(state, null, 0));

        if (state.name === "closed") {
          this.#playing = undefined;
          this.#notifyGameStateChangeAsync();
          return Action.noop;
        }

        if (state.name === "idle") {
          if (state.state) {
            this.#playing = {
              name,
              state: {
                ...this.#playing?.state ?? {},
                ...state.state,
              } as any,
            };
            this.#notifyGameStateChangeAsync();
          }
        }

        const { done, value } = solver.next(state);
        if (done) {
          this.#playing = undefined;
          this.#notifyGameStateChangeAsync();
          return Action.noop;
        }
        console.debug("[DEBUG]", "next action", JSON.stringify(value, null, 0));
        console.debug("[DEBUG]", "sending action", JSON.stringify(value, null, 0));

        return value;
      });
    } catch (err) {
      console.warn("[WARN]", "failed to start IPC receiver, continuing without browser IPC:", err instanceof Error ? err.message : String(err));
    }
  }

  async speech(generated?: TalkModelGenerateResult) {
    const event: SpeechEvent = typeof generated === "string" ? { text: generated } : generated !== undefined ? {
      nGram: this.#currentNGramSize,
      nGramRaw: this.#currentNGramSizeRaw,
      ...generated,
    } : (() => {
      const ret = this.#talkModel.generate("", this.#currentNGramSize);
      return typeof ret === "string" ? {
        text: ret,
      } : {
        nGram: this.#currentNGramSize,
        nGramRaw: this.#currentNGramSizeRaw,
        ...ret,
      };
    })();

    await this.#speechQueue.enqueue(event);
  }

  onSpeech(cb: (event: SpeechEvent) => Promise<void>): MakaMujo {
    this.#speechQueue.onSpeech(cb);
    return this;
  }

  onTtsError(cb: (text: string, err: unknown) => void): MakaMujo {
    this.#speechQueue.onTtsError(cb);
    return this;
  }

  onSpeechComplete(cb: () => Promise<void>): MakaMujo {
    this.#speechQueue.onSpeechComplete(cb);
    return this;
  }

  onGameStateChange(cb: () => void): MakaMujo {
    this.#gameStateChangeListeners.push(cb);
    return this;
  }

  #notifyGameStateChangeAsync(): void {
    const listenersSnapshot = [...this.#gameStateChangeListeners];
    queueMicrotask(() => {
      for (const listener of listenersSnapshot) {
        try { listener(); } catch { /* ignore */ }
      }
    });
  }

  /**
   * CommentPipeline steps 1–9 (architecture/domain-model-redesign.md).
   */
  listen(comments: AgentComment[]) {
    for (const { data } of comments) {
      const commentData = data as CommentData;
      // Step 1 — NFC normalize for learning / topic; system match uses raw where noted
      const comment = commentData.comment.normalize("NFC").trim();
      console.debug("[DEBUG]", "comment", JSON.stringify(data, null, 0));

      // Step 2 — all comments refresh silence clock
      this.#lastCommentAt = new Date(Date.now());
      // Step 3
      this.#hasPromptedCommentForViewerIncrease = false;

      // Step 4
      if (typeof data.no === "number" && data.no > 0) {
        const commentNumber = data.no;
        this.#currentNGramSizeRaw = inferNGramSizeRaw(commentNumber);
        this.#currentNGramSize = inferNGramSize(commentNumber);
      }

      // Step 5 — truthy no or owner
      if (data.no || data.isOwner) {
        this.#learn(`${comment}。`);
      }

      // Step 6 — user no or cruise name
      if (data.no || (data.userId === "onecomme.system" && data.name === "生放送クルーズ")) {
        console.log("[INFO]", `got a comment: "${comment}"`);
        const topic = pickTopic(comment);
        if (topic) {
          if (this.#streamState) {
            this.#streamState.replyTargetComment = {
              text: comment,
              pickedTopic: topic,
            };
          }
          this.speech(this.#talkModel.generate(topic, this.#currentNGramSize));
        }
      }

      let isAd = false;

      // Step 7 — system scripts (raw comment text for exact matches)
      if (data.userId === "onecomme.system") {
        if (isCruiseQuoteStart(commentData.comment)) {
          console.log("[INFO]", `niconama cruise is coming`);
          for (const text of CRUISE_WELCOME_SPEECHES) {
            this.speech(text);
          }
          continue;
        }

        if (isAdCompletedComment(commentData.comment)) {
          isAd = true;
          const name = extractAdName(commentData.comment);

          console.log("[INFO]", `AD ${name}`);
          this.speech(formatAdThanks(name));
          continue;
        }

        if (isStreamEndOneMinute(commentData.comment)) {
          console.log("[INFO]", "announce the end of a stream...");
          for (const text of STREAM_END_SPEECHES) {
            this.speech(text);
          }
          continue;
        }
      }

      // Step 8 — program comment counter (not monotonic)
      if (typeof commentData.no === "number" && commentData.no > 0 && this.#currentProgramUrl) {
        this.#currentProgramLatestCommentNo = commentData.no;
        if (this.#streamState && this.#streamState.meta) {
          const existingTotal = this.#streamState.meta.total ?? { listeners: 0, gift: 0, ad: 0 };
          this.#streamState.meta = {
            ...this.#streamState.meta,
            total: { ...existingTotal, comments: this.#currentProgramLatestCommentNo },
          };
        }
      }

      // Step 9 — gift
      if (data.hasGift && !isAd) {
        const name = (data as any).origin?.message?.gift?.advertiserName;
        console.log(`[GIFT] ${name}`);
        this.speech(formatGiftThanks(name, Boolean(data.anonymity)));
        continue;
      }
    }
  }

  #learn(text: `${string}。`) {
    this.#talkModel.learn(text);
  }

  onAir(state: StreamData | unknown) {
    const streamData = state as StreamData | undefined;
    switch (streamData?.type) {
      case "niconama": {
        const { isLive, title, startTime: start, url, total: listeners, points } = streamData.data;
        if (isLive) {
          if (this.#currentProgramUrl !== url) {
            this.#currentProgramUrl = url;
            this.#currentProgramLatestCommentNo = 0;
            this.#hasPromptedCommentForViewerIncrease = false;
          }

          if (this.#lastListenerCount !== listeners) {
            this.#lastListenerCount = listeners;
            this.#listenersStaleSince = new Date(Date.now());
            const now = Date.now();
            const commentsStale = isCommentsStale(this.#lastCommentAt, now, SILENCE_THRESHOLD_MS);
            const hadCommentBefore = this.#lastCommentAt !== undefined;
            if (shouldPromptCommentAfterViewerIncrease({
              hadCommentBefore,
              commentsStale,
              hasPromptedCommentForViewerIncrease: this.#hasPromptedCommentForViewerIncrease,
            })) {
              this.#hasPromptedCommentForViewerIncrease = true;
              const promptText = COMMENT_PROMPT_TEXT;
              const clearOnError = (text: string, err: unknown) => {
                if (text === promptText) {
                  const msg = err instanceof Error ? err.message : String(err);
                  console.error("[ERROR]", "prompting comment failed", msg);
                  this.#hasPromptedCommentForViewerIncrease = false;
                  this.#speechQueue.removeTtsErrorHandler(clearOnError);
                }
              };
              this.#speechQueue.onTtsError(clearOnError);
              void this.speech(promptText);
            }
          }
        } else {
          this.#lastListenerCount = undefined;
          this.#listenersStaleSince = undefined;
          this.#currentProgramUrl = undefined;
          this.#currentProgramLatestCommentNo = 0;
        }

        this.#streamState = isLive ? {
          type: "live",
          meta: {
            title,
            start,
            url,
            total: {
              listeners,
              gift: typeof points?.gift === "string" ? Number.parseFloat(points.gift) : points?.gift,
              ad: typeof points?.ad === "string" ? Number.parseFloat(points.ad) : points?.ad,
              comments: this.#currentProgramLatestCommentNo,
            },
          },
        } : undefined;
        break;
      }
    }
  }

  get speechable() {
    return evaluateSpeechable({
      streamLive: this.#streamState !== undefined,
      lastCommentAt: this.#lastCommentAt,
      listenersStaleSince: this.#listenersStaleSince,
      hasPromptedCommentForViewerIncrease: this.#hasPromptedCommentForViewerIncrease,
      browserStateName: this.#browserState?.name,
      nowMs: Date.now(),
      thresholdMs: SILENCE_THRESHOLD_MS,
    });
  }

  get playing() {
    return this.#playing;
  }

  get canSpeak() {
    return this.speechable;
  }

  get currentGame() {
    return this.#playing;
  }

  get currentNGramSize() {
    return this.#currentNGramSize;
  }

  get currentNGramSizeRaw() {
    return this.#currentNGramSizeRaw;
  }

  get streamState() {
    return this.#streamState;
  }

  get Component() {
    if (this.#playing === undefined) return () => null;
    return Games[this.#playing.name].Component;
  }

  get talkModel() {
    return this.#talkModel;
  }
}

export type TalkModelGenerateResult = string | { text: string; nodes?: string[] };

export interface TalkModel {
  generate(start?: string, nGram?: number): TalkModelGenerateResult;
  learn(text: string): void;
  toJSON(): string;
}

type SpeechOptions = {
  additionalHalfTone?: number;
  speakingRate?: number;
};

export interface TTS {
  speech(text: string, options?: SpeechOptions): Promise<void>;
}

type StreamData =
  | {
    type: "niconama";
    data: {
      title: string;
      isLive: boolean;
      startTime: number;
      total: number;
      points: {
        gift: number | string;
        ad: number | string;
      };
      url: string;
    };
  };

type CommentData = {
  comment: string;
  no?: number;
  isOwner?: boolean;
  anonymity: boolean;
  name?: string;
  userId?: string;
  hasGift: boolean;
};
