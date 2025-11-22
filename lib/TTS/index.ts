import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TTS } from "../Agent";
import { play } from "./ALSA";
import { generateWavFile, type OpenJTalkOptions } from "./OpenJTalk";

export default class implements TTS {
  #htsvoiceFile: string
  #dictionaryDir: string

  #tempDir: string;

  constructor({ htsvoiceFile, dictionaryDir }: OpenJTalkOptions) {
    this.#htsvoiceFile = htsvoiceFile;
    this.#dictionaryDir = dictionaryDir;

    this.#tempDir = mkdtempSync(join(tmpdir(), 'makamujo-'));
  }

  speech(text: string) {
    const tempFile = `${join(this.#tempDir, 'speech')}.wav` satisfies `${string}.wav`;
    try {
      generateWavFile(text, tempFile, {
        htsvoiceFile: this.#htsvoiceFile,
        dictionaryDir: this.#dictionaryDir,
      });
      play(tempFile);
    } finally {
      rmSync(tempFile, { force: true });
    }
  }

  close() {
    rmSync(this.#tempDir, { recursive: true, force: true });
  }
}
