import { describe, expect, it } from "bun:test";
import {
  formatJst,
  GAME_MIN_FPS,
  isAudioPlaying,
  isFpsAboveThreshold,
  isOverallOk,
  type MotionSample,
  summarizeFps,
  toErrorResult,
  VIDEO_MIN_FPS,
} from "./check-stream.ts";

describe("formatJst", () => {
  it("formats date in JST with correct format", () => {
    const date = new Date("2024-01-15T12:30:45.000Z");
    const result = formatJst(date);
    expect(result).toBe("2024-01-15 21:30:45");
  });

  it("handles different months correctly", () => {
    const date = new Date("2024-12-25T00:00:00.000Z");
    const result = formatJst(date);
    expect(result).toBe("2024-12-25 09:00:00");
  });
});

describe("isAudioPlaying", () => {
  it("returns false when decoded bytes do not increase", () => {
    expect(isAudioPlaying(0, 0)).toBe(false);
    expect(isAudioPlaying(100, 100)).toBe(false);
  });

  it("returns true when decoded bytes increase", () => {
    expect(isAudioPlaying(0, 1)).toBe(true);
    expect(isAudioPlaying(100, 250)).toBe(true);
  });
});

describe("video and game FPS thresholds", () => {
  it("uses 24 fps for the whole video and 8 fps for the game screen", () => {
    expect(VIDEO_MIN_FPS).toBe(24);
    expect(GAME_MIN_FPS).toBe(8);
  });
});

describe("isFpsAboveThreshold", () => {
  it("treats the threshold itself as an error", () => {
    expect(isFpsAboveThreshold(24, VIDEO_MIN_FPS)).toBe(false);
    expect(isFpsAboveThreshold(8, GAME_MIN_FPS)).toBe(false);
  });

  it("passes only when the minimum fps exceeds the threshold", () => {
    expect(isFpsAboveThreshold(24.5, VIDEO_MIN_FPS)).toBe(true);
    expect(isFpsAboveThreshold(0, GAME_MIN_FPS)).toBe(false);
    expect(isFpsAboveThreshold(8.5, GAME_MIN_FPS)).toBe(true);
  });
});

describe("isOverallOk", () => {
  it("returns false if any check fails", () => {
    expect(isOverallOk(false, true, true)).toBe(false);
    expect(isOverallOk(true, false, true)).toBe(false);
    expect(isOverallOk(true, true, false)).toBe(false);
    expect(isOverallOk(false, false, false)).toBe(false);
  });

  it("returns true only when all three checks pass", () => {
    expect(isOverallOk(true, true, true)).toBe(true);
  });
});

describe("summarizeFps", () => {
  const sample = (elapsedMs: number, changed: boolean): MotionSample => ({
    elapsedMs,
    wholeChanged: changed,
    gameChanged: changed,
  });

  /** One changed frame every 100ms for the whole window. */
  const steadySamples = (
    windowMs: number,
    intervalMs: number,
  ): MotionSample[] => {
    const samples: MotionSample[] = [];
    for (let t = 0; t < windowMs; t += intervalMs) {
      samples.push(sample(t, true));
    }
    return samples;
  };

  it("reports zero fps for empty or still input", () => {
    expect(summarizeFps([], (s) => s.wholeChanged, 1000, 10000)).toEqual({
      minFps: 0,
      avgFps: 0,
      changedFrames: 0,
      comparedFrames: 0,
    });
    const still = steadySamples(10000, 100).map((s) => ({
      ...s,
      wholeChanged: false,
    }));
    expect(summarizeFps(still, (s) => s.wholeChanged, 1000, 10000)).toEqual({
      minFps: 0,
      avgFps: 0,
      changedFrames: 0,
      comparedFrames: 100,
    });
  });

  it("measures ten fps for one changed frame every 100ms", () => {
    const summary = summarizeFps(
      steadySamples(10000, 100),
      (s) => s.wholeChanged,
      1000,
      10000,
    );
    expect(summary.minFps).toBe(10);
    expect(summary.avgFps).toBe(10);
    expect(summary.changedFrames).toBe(100);
    expect(summary.comparedFrames).toBe(100);
  });

  it("exposes a one-second freeze as a zero minimum", () => {
    const samples = steadySamples(10000, 100).map((s) =>
      s.elapsedMs >= 4000 && s.elapsedMs < 5000
        ? { ...s, wholeChanged: false }
        : s,
    );
    const summary = summarizeFps(samples, (s) => s.wholeChanged, 1000, 10000);
    expect(summary.minFps).toBe(0);
    expect(summary.avgFps).toBe(9);
    expect(summary.changedFrames).toBe(90);
  });

  it("summarises a single region picked from each sample", () => {
    const samples = steadySamples(10000, 100).map((s, index) => ({
      ...s,
      gameChanged: index % 2 === 0,
    }));
    const summary = summarizeFps(samples, (s) => s.gameChanged, 1000, 10000);
    expect(summary.minFps).toBe(5);
    expect(summary.avgFps).toBe(5);
    expect(summary.changedFrames).toBe(50);
  });

  it("ignores samples recorded past the window", () => {
    const samples = [...steadySamples(10000, 100), sample(12000, true)];
    const summary = summarizeFps(samples, (s) => s.wholeChanged, 1000, 10000);
    expect(summary.changedFrames).toBe(100);
    expect(summary.comparedFrames).toBe(100);
  });
});

describe("toErrorResult", () => {
  it("produces a failing result so the workflow can still file an issue", () => {
    const result = toErrorResult(
      new Error("Timeout 30000ms exceeded"),
      "2024-01-15 21:30:45",
    );
    expect(result.ok).toBe(false);
    expect(result.timestampJst).toBe("2024-01-15 21:30:45");
    expect(result.phenomena).toEqual([
      "チェック中に想定外のエラーが発生しました: Timeout 30000ms exceeded",
    ]);
    expect(result.details).toEqual({
      audioPlaying: false,
      videoPlaying: false,
      gameScreenPlaying: false,
    });
  });

  it("stringifies non-Error throwables", () => {
    const result = toErrorResult("boom", "2024-01-15 21:30:45");
    expect(result.ok).toBe(false);
    expect(result.phenomena).toEqual([
      "チェック中に想定外のエラーが発生しました: boom",
    ]);
  });
});
