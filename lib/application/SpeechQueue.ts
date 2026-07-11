import {
  shouldInvokeTts,
  trimmedSpeechText,
} from "../domain/speech/emptySpeech";

export type SpeechEvent = {
  text: string;
  nGram?: number;
  nGramRaw?: number;
  nodes?: string[];
};

export type SpeechOptions = {
  additionalHalfTone?: number;
  speakingRate?: number;
};

export type SpeechQueueTts = {
  speech(text: string, options?: SpeechOptions): Promise<void>;
};

/**
 * Serial speech queue: listeners + optional TTS, then complete listeners.
 * Errors on the chain are swallowed so subsequent enqueues still run (legacy).
 */
export class SpeechQueue {
  #tts: SpeechQueueTts;
  #speechPromise = Promise.resolve();
  #speechListeners: Array<(event: SpeechEvent) => Promise<void>> = [];
  #speechCompleteListeners: Array<() => Promise<void>> = [];
  #ttsErrorHandlers: Array<(text: string, err: unknown) => void> = [];

  constructor(tts: SpeechQueueTts) {
    this.#tts = tts;
  }

  onSpeech(cb: (event: SpeechEvent) => Promise<void>): void {
    this.#speechListeners.push(cb);
  }

  onSpeechComplete(cb: () => Promise<void>): void {
    this.#speechCompleteListeners.push(cb);
  }

  onTtsError(cb: (text: string, err: unknown) => void): void {
    this.#ttsErrorHandlers.push(cb);
  }

  /** Temporary handlers (e.g. prompt failure) — filter by identity. */
  removeTtsErrorHandler(cb: (text: string, err: unknown) => void): void {
    this.#ttsErrorHandlers = this.#ttsErrorHandlers.filter((h) => h !== cb);
  }

  enqueue(event: SpeechEvent): Promise<void> {
    this.#speechPromise = this.#speechPromise
      .then(async () => {
        const tasks: Array<Promise<void>> = [
          ...this.#speechListeners.map((f) => f(event)),
        ];
        const trimmedText = trimmedSpeechText(event.text);
        if (shouldInvokeTts(event.text)) {
          const ttsTask = this.#tts
            .speech(trimmedText, { additionalHalfTone: 3, speakingRate: 1.2 })
            .catch((err) => {
              for (const h of this.#ttsErrorHandlers) {
                try {
                  void h(trimmedText, err);
                } catch {
                  /* ignore handler errors */
                }
              }
              throw err;
            });
          tasks.unshift(ttsTask);
        }
        await Promise.all(tasks);
        await Promise.all(
          this.#speechCompleteListeners.map((f) => Promise.resolve(f())),
        );
      })
      .catch(() => Promise.resolve());

    return this.#speechPromise;
  }
}
