import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";
import { AUDIO_FAILURE_COOLDOWN_MS } from "../domain/tts/audioAvailability";
import TTS from ".";

// Variables starting with "mock" are available in mock.module factory closures
// even after hoisting (following the same convention as jest.mock).
const mockPlayback = { played: true, calls: 0 };
const mockSynthesis = { calls: 0 };

mock.module("./ALSA", () => ({
  play: async () => {
    mockPlayback.calls += 1;
    return mockPlayback.played
      ? ({ played: true } as const)
      : ({ played: false, reason: "exit 1: Connection refused" } as const);
  },
}));

mock.module("./OpenJTalk", () => ({
  generateWavFile: async () => {
    mockSynthesis.calls += 1;
  },
}));

const constructTts = () =>
  new TTS({
    htsvoiceFile: "/dev/null/voice.htsvoice",
    dictionaryDir: "/dev/null/dic",
  });

const suppressedFor = (now: number) => now + AUDIO_FAILURE_COOLDOWN_MS;

describe("TTS with an unavailable audio backend", () => {
  const errorLines: string[] = [];

  beforeEach(() => {
    mockPlayback.played = true;
    mockPlayback.calls = 0;
    mockSynthesis.calls = 0;
    errorLines.length = 0;
    jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errorLines.push(args.map(String).join(" "));
    });
    jest.spyOn(Date, "now").mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps synthesising and playing while the backend answers", async () => {
    const tts = constructTts();
    try {
      await tts.speech("こんにちは");
      await tts.speech("こんばんは");

      expect(mockSynthesis.calls).toBe(2);
      expect(mockPlayback.calls).toBe(2);
      expect(errorLines).toEqual([]);
    } finally {
      tts.close();
    }
  });

  it("stops paying synthesis and player cost while the outage holds", async () => {
    const tts = constructTts();
    try {
      mockPlayback.played = false;
      await tts.speech("1");
      await tts.speech("2");
      await tts.speech("3");
      expect(mockSynthesis.calls).toBe(3);
      expect(mockPlayback.calls).toBe(3);

      // Suppressed: no synthesis, no players, and still no rejection, so the
      // speech queue keeps draining instead of stalling.
      jest.spyOn(Date, "now").mockReturnValue(1);
      await expect(tts.speech("4")).resolves.toBeUndefined();
      expect(mockSynthesis.calls).toBe(3);
      expect(mockPlayback.calls).toBe(3);

      // Cooldown over: probe once, which fails and re-arms the window.
      jest.spyOn(Date, "now").mockReturnValue(suppressedFor(0));
      await tts.speech("5");
      expect(mockSynthesis.calls).toBe(4);
      expect(mockPlayback.calls).toBe(4);
    } finally {
      tts.close();
    }
  });

  it("reports one notice per outage and one recovery, not one per utterance", async () => {
    const tts = constructTts();
    try {
      mockPlayback.played = false;
      for (const attempt of [1, 2, 3, 4]) {
        jest
          .spyOn(Date, "now")
          .mockReturnValue(attempt * AUDIO_FAILURE_COOLDOWN_MS);
        await tts.speech("x");
      }

      expect(errorLines).toEqual([
        "[TTS] audio output unavailable after 3 failures; suppressing voice for 30s",
        "[TTS] audio output unavailable after 3 failures; suppressing voice for 30s",
      ]);

      mockPlayback.played = true;
      jest.spyOn(Date, "now").mockReturnValue(10 * AUDIO_FAILURE_COOLDOWN_MS);
      await tts.speech("y");

      expect(errorLines).toContain("[TTS] audio output recovered");
    } finally {
      tts.close();
    }
  });

  it("restarts the streak after a recovery, so a later outage re-arms", async () => {
    const tts = constructTts();
    try {
      mockPlayback.played = false;
      for (const attempt of [1, 2, 3]) {
        jest
          .spyOn(Date, "now")
          .mockReturnValue(attempt * AUDIO_FAILURE_COOLDOWN_MS);
        await tts.speech("x");
      }
      mockPlayback.played = true;
      await tts.speech("recovered");

      errorLines.length = 0;
      mockPlayback.played = false;
      await tts.speech("single failure");
      expect(mockPlayback.calls).toBeGreaterThan(0);
      expect(errorLines).toEqual([]);
    } finally {
      tts.close();
    }
  });

  it("still rejects once closed, regardless of the outage state", async () => {
    const tts = constructTts();
    mockPlayback.played = false;
    await tts.speech("x");
    tts.close();

    await expect(tts.speech("y")).rejects.toThrow("TTS is closed");
  });
});
