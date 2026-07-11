import type { AgentComment } from "automated-gameplay-transmitter";
import { AgentSession } from "../application/AgentSession";
import { CommentApplicationService } from "../application/CommentApplicationService";
import { GameplayApplicationService } from "../application/GameplayApplicationService";
import { type SpeechEvent, SpeechQueue } from "../application/SpeechQueue";
import { StreamApplicationService } from "../application/StreamApplicationService";
import type { TalkModelGenerateResult as AppTalkModelGenerateResult } from "../application/types";
import { evaluateSpeechable } from "../domain/broadcasting/SilencePolicy";
export const SILENCE_THRESHOLD_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * Thin facade: owns AgentSession + SpeechQueue, exposes AgentLike surface.
 * Domain side-effects live in application services.
 */
export class MakaMujo {
  #talkModel: TalkModel;
  #session = new AgentSession();
  #speechQueue: SpeechQueue;
  #comments: CommentApplicationService;
  #stream: StreamApplicationService;
  #gameplay: GameplayApplicationService;
  #gameStateChangeListeners: Array<() => void> = [];

  constructor(talkModel: TalkModel, tts: TTS) {
    this.#talkModel = talkModel;
    this.#speechQueue = new SpeechQueue(tts);

    const speechPort = {
      speech: (generated?: AppTalkModelGenerateResult) =>
        this.speech(generated),
    };

    this.#comments = new CommentApplicationService(
      this.#session,
      talkModel,
      speechPort,
    );
    this.#stream = new StreamApplicationService(
      this.#session,
      speechPort,
      this.#speechQueue,
      { silenceThresholdMs: SILENCE_THRESHOLD_MS },
    );
    this.#gameplay = new GameplayApplicationService(
      this.#session,
      () => this.speechable,
      () => this.#notifyGameStateChangeAsync(),
    );
  }

  play(name: Parameters<GameplayApplicationService["play"]>[0], data?: string) {
    this.#gameplay.play(name, data);
  }

  async speech(generated?: TalkModelGenerateResult) {
    const session = this.#session;
    const event: SpeechEvent =
      typeof generated === "string"
        ? { text: generated }
        : generated !== undefined
          ? {
              nGram: session.currentNGramSize,
              nGramRaw: session.currentNGramSizeRaw,
              ...generated,
            }
          : (() => {
              const ret = this.#talkModel.generate(
                "",
                session.currentNGramSize,
              );
              return typeof ret === "string"
                ? {
                    text: ret,
                  }
                : {
                    nGram: session.currentNGramSize,
                    nGramRaw: session.currentNGramSizeRaw,
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
        try {
          listener();
        } catch {
          /* ignore */
        }
      }
    });
  }

  listen(comments: AgentComment[]) {
    this.#comments.listen(comments);
  }

  onAir(state: unknown) {
    this.#stream.onAir(state);
  }

  get speechable() {
    const session = this.#session;
    return evaluateSpeechable({
      streamLive: session.streamState !== undefined,
      lastCommentAt: session.lastCommentAt,
      listenersStaleSince: session.listenersStaleSince,
      hasPromptedCommentForViewerIncrease:
        session.hasPromptedCommentForViewerIncrease,
      browserStateName: session.browserState?.name,
      nowMs: Date.now(),
      thresholdMs: SILENCE_THRESHOLD_MS,
    });
  }

  get playing() {
    return this.#session.playing;
  }

  get canSpeak() {
    return this.speechable;
  }

  get currentGame() {
    return this.#session.playing;
  }

  get currentNGramSize() {
    return this.#session.currentNGramSize;
  }

  get currentNGramSizeRaw() {
    return this.#session.currentNGramSizeRaw;
  }

  get streamState() {
    return this.#session.streamState;
  }

  get Component() {
    return this.#gameplay.Component;
  }

  get talkModel() {
    return this.#talkModel;
  }
}

export type TalkModelGenerateResult =
  | string
  | { text: string; nodes?: string[] };

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
