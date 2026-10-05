import { rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { TTS } from "../Agent";
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
  TTS_TEMPORARY_DIRECTORY_PREFIX,
} from "../temporaryDirectory";
import { play } from "./ALSA";
import { generateWavFile, type OpenJTalkOptions } from "./OpenJTalk";

export default class implements TTS {
  #htsvoiceFile: string;
  #dictionaryDir: string;

  #tempDir: string | undefined;

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
    const tempFile = `${join(tempDir, "speech")}.wav` satisfies `${string}.wav`;
    try {
      await generateWavFile(text, tempFile, {
        htsvoiceFile: this.#htsvoiceFile,
        dictionaryDir: this.#dictionaryDir,
        ...options,
      });
      await play(tempFile);
    } finally {
      rmSync(tempFile, { force: true });
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
