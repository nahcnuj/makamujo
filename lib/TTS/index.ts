import { rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { TTS } from "../Agent";
import {
  AUDIO_FAILURE_COOLDOWN_MS,
  AUDIO_FAILURE_THRESHOLD,
  type AudioAvailability,
  initialAudioAvailability,
  isAudioAvailable,
  isAudioSuppressed,
  recordAudioFailure,
  recordAudioSuccess,
} from "../domain/tts/audioAvailability";
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
  TTS_TEMPORARY_DIRECTORY_PREFIX,
} from "../temporaryDirectory";
import { type PlaybackOutcome, play } from "./ALSA";
import { generateWavFile, type OpenJTalkOptions } from "./OpenJTalk";

export default class implements TTS {
  #htsvoiceFile: string;
  #dictionaryDir: string;

  #tempDir: string | undefined;

  #audioAvailability: AudioAvailability = initialAudioAvailability();

  constructor({
    htsvoiceFile,
    dictionaryDir,
  }: Pick<OpenJTalkOptions, "htsvoiceFile" | "dictionaryDir">) {
    this.#htsvoiceFile = htsvoiceFile;
    this.#dictionaryDir = dictionaryDir;

    this.#tempDir = createTemporaryDirectory(TTS_TEMPORARY_DIRECTORY_PREFIX);
  }

  async speech(text: string, options = {}) {
    const tempDir = this.#tempDir;
    if (tempDir === undefined) {
      throw new Error("TTS is closed");
    }
    if (!isAudioAvailable(this.#audioAvailability, Date.now())) {
      return;
    }
    const tempFile = `${join(tempDir, "speech")}.wav` satisfies `${string}.wav`;
    try {
      await generateWavFile(text, tempFile, {
        htsvoiceFile: this.#htsvoiceFile,
        dictionaryDir: this.#dictionaryDir,
        ...options,
      });
      this.#recordPlayback(await play(tempFile));
    } finally {
      rmSync(tempFile, { force: true });
    }
  }

  /**
   * Fold a playback outcome into the availability policy and report the edges of
   * an outage, so a backend that stays down costs one notice per cooldown
   * instead of one per utterance.
   */
  #recordPlayback(outcome: PlaybackOutcome) {
    const now = Date.now();
    const previousAvailability = this.#audioAvailability;
    const wasFailing = previousAvailability.consecutiveFailures > 0;
    const wasSuppressed = isAudioSuppressed(previousAvailability, now);
    this.#audioAvailability = outcome.played
      ? recordAudioSuccess()
      : recordAudioFailure(previousAvailability, now);
    if (outcome.played) {
      if (wasFailing) console.error("[TTS] audio output recovered");
      return;
    }
    if (!wasSuppressed && isAudioSuppressed(this.#audioAvailability, now)) {
      console.error(
        `[TTS] audio output unavailable after ${AUDIO_FAILURE_THRESHOLD} failures; suppressing voice for ${AUDIO_FAILURE_COOLDOWN_MS / 1000}s`,
      );
    }
  }

  /**
   * Remove the scratch directory. Idempotent, so the exit handler and a signal
   * handler may both call it.
   */
  close() {
    const tempDir = this.#tempDir;
    if (tempDir === undefined) return;
    this.#tempDir = undefined;
    removeTemporaryDirectory(tempDir);
  }
}

export class FallbackTTS implements TTS {
  async speech(text: string) {
    await setTimeout(10_000);
    console.debug("[DEBUG]", "Fallback.speech", text);
  }

  close() {}
}
