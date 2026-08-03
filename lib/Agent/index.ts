import type { AgentComment } from "automated-gameplay-transmitter";
import { AgentSession } from "../application/AgentSession";
import { CommentApplicationService } from "../application/CommentApplicationService";
import { GameplayApplicationService } from "../application/GameplayApplicationService";
import { SpeechQueue, type SpeechEvent } from "../application/SpeechQueue";
import { StreamApplicationService } from "../application/StreamApplicationService";
import type { TalkModelGenerateResult as AppTalkModelGenerateResult } from "../application/types";
import { evaluateSpeechable } from "../domain/broadcasting/SilencePolicy";
import { pickRandomFrom, segmentWords } from "../domain/comments/TopicPicker";
export const SILENCE_THRESHOLD_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * Thin facade: owns AgentSession + SpeechQueue, exposes AgentLike surface.
 * Domain side-effects live in application services.
 */
export class MakaMujo {
  #talkModel: TalkModel;
  #tts: TTS;
  #session = new AgentSession();
  #speechQueue: SpeechQueue;
  #comments: CommentApplicationService;
  #stream: StreamApplicationService;
  #gameplay: GameplayApplicationService;
  #gameStateChangeListeners: Array<() => void> = [];
  /**
   * Pending Markov start tokens for the next spontaneous turn.
   * Empty → generate("") (legacy random seed).
   */
  #nextStart: string[] = [];
  /** In-process set of news lines already learned (at most once). */
  #learnedNewsLines = new Set<string>();
  /** Latest news lines from sight (for spontaneous topic). */
  #currentNewsLines: string[] = [];

  constructor(talkModel: TalkModel, tts: TTS) {
    this.#talkModel = talkModel;
    this.#tts = tts;
    this.#speechQueue = new SpeechQueue(tts);

    const speechPort = {
      speech: (generated?: AppTalkModelGenerateResult) => this.speech(generated),
    };

    this.#comments = new CommentApplicationService(this.#session, talkModel, speechPort);
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
      (sightState) => this.#onGameSight(sightState),
    );
  }

  #onGameSight(sightState: Record<string, unknown>): void {
    const raw = sightState.newsLines;
    const lines = Array.isArray(raw)
      ? raw
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((s) => s.normalize("NFC").trim())
      : [];
    this.#currentNewsLines = lines;

    for (const line of lines) {
      if (this.#learnedNewsLines.has(line)) continue;
      this.#talkModel.learn(`${line}。`);
      this.#learnedNewsLines.add(line);
    }
  }

  play(name: Parameters<GameplayApplicationService["play"]>[0], data?: string) {
    this.#gameplay.play(name, data);
  }

  async speech(generated?: TalkModelGenerateResult) {
    const session = this.#session;

    // Comment replies (and news via re-entry) pass a generated result — never strip.
    if (typeof generated === "string") {
      const event: SpeechEvent = { text: generated };
      await this.#speechQueue.enqueue(event);
      this.#maybeQueueContinuation(event);
      return;
    }
    if (generated !== undefined) {
      const event: SpeechEvent = {
        nGram: session.currentNGramSize,
        nGramRaw: session.currentNGramSizeRaw,
        ...generated,
      };
      await this.#speechQueue.enqueue(event);
      this.#maybeQueueContinuation(event);
      return;
    }

    // Spontaneous
    const pending = this.#nextStart;
    this.#nextStart = [];

    // News: same as comment — generate(topic) then speech(generated) (no strip).
    if (pending.length === 0 && this.#currentNewsLines.length > 0) {
      const topic = pickRandomFrom(segmentWords(this.#currentNewsLines.join("")));
      if (topic) {
        await this.speech(
          this.#talkModel.generate(topic, session.currentNGramSize),
        );
        return;
      }
    }

    // Continuation: strip seed. Empty start: random seed (strip no-op).
    const fromContinuation = pending.length > 0;
    const start = fromContinuation ? pending[pending.length - 1]! : "";
    const ret = this.#talkModel.generate(start, session.currentNGramSize);
    const shouldStripSeed = fromContinuation && Boolean(start);

    const event: SpeechEvent = (() => {
      if (typeof ret === "string") {
        const text =
          shouldStripSeed && ret.startsWith(start) ? ret.slice(start.length) : ret;
        return { text };
      }
      const rawText = ret.text;
      const text =
        shouldStripSeed && rawText.startsWith(start)
          ? rawText.slice(start.length)
          : rawText;
      const nodes = Array.isArray(ret.nodes)
        ? shouldStripSeed && ret.nodes[0] === start
          ? ret.nodes.slice(1)
          : ret.nodes
        : undefined;
      return {
        nGram: session.currentNGramSize,
        nGramRaw: session.currentNGramSizeRaw,
        text,
        nodes,
      };
    })();

    await this.#speechQueue.enqueue(event);
    this.#maybeQueueContinuation(event);
  }

  #maybeQueueContinuation(event: SpeechEvent): void {
    const text = event.text.trimEnd();
    if (!text || text.endsWith("。")) {
      return;
    }

    const nodes = event.nodes;
    if (nodes === undefined || nodes.length === 0) {
      return;
    }
    const seed = nodes[nodes.length - 1];
    if (seed === undefined || seed === "。") {
      return;
    }

    if (this.#nextStart.length > 0) {
      return;
    }
    this.#nextStart = [seed];
    void this.speech();
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
      hasPromptedCommentForViewerIncrease: session.hasPromptedCommentForViewerIncrease,
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
