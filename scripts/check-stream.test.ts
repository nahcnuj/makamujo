import { describe, expect, it } from "bun:test";
import {
  calculateDiffRatio,
  clipFromBox,
  formatJst,
  GAME_CLIP,
  isAudioPlaying,
  isOverallOk,
  isPictureMoving,
  type SampledFrame,
  summarizeMotion,
  toErrorResult,
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

describe("isPictureMoving", () => {
  it("returns false when the frame barely changes", () => {
    expect(isPictureMoving(0)).toBe(false);
    expect(isPictureMoving(0.009)).toBe(false);
  });

  it("returns true when the frame changes enough", () => {
    expect(isPictureMoving(0.01)).toBe(true);
    expect(isPictureMoving(0.5)).toBe(true);
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

describe("calculateDiffRatio", () => {
  const frame = (pixels: number[][]): SampledFrame => ({
    width: 1,
    height: pixels.length,
    data: pixels.flat(),
  });

  it("returns 0 for identical frames", () => {
    const before = frame([
      [1, 2, 3, 255],
      [4, 5, 6, 255],
    ]);
    const after = frame([
      [1, 2, 3, 255],
      [4, 5, 6, 255],
    ]);
    expect(calculateDiffRatio(before, after)).toBe(0);
  });

  it("returns 1 for completely different frames", () => {
    const before = frame([
      [0, 0, 0, 255],
      [10, 20, 30, 255],
    ]);
    const after = frame([
      [255, 255, 255, 255],
      [250, 240, 230, 255],
    ]);
    expect(calculateDiffRatio(before, after)).toBe(1);
  });

  it("returns the ratio of changed pixels for partial changes", () => {
    const before = frame([
      [0, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    const after = frame([
      [255, 255, 255, 255],
      [0, 0, 0, 255],
    ]);
    expect(calculateDiffRatio(before, after)).toBe(0.5);
  });

  it("ignores changes within the per-channel tolerance", () => {
    const before = frame([[100, 100, 100, 255]]);
    const after = frame([[110, 110, 110, 255]]);
    expect(calculateDiffRatio(before, after)).toBe(0);
  });

  it("ignores alpha-only changes", () => {
    const before = frame([[10, 20, 30, 0]]);
    const after = frame([[10, 20, 30, 255]]);
    expect(calculateDiffRatio(before, after)).toBe(0);
  });

  it("returns 1 for frames of different dimensions", () => {
    const before: SampledFrame = {
      width: 1,
      height: 1,
      data: [0, 0, 0, 255],
    };
    const after: SampledFrame = {
      width: 1,
      height: 2,
      data: [0, 0, 0, 255, 0, 0, 0, 255],
    };
    expect(calculateDiffRatio(before, after)).toBe(1);
  });
});

describe("summarizeMotion", () => {
  const solid = (value: number): SampledFrame => ({
    width: 2,
    height: 1,
    data: [value, value, value, 255, value, value, value, 255],
  });

  it("reports no motion for empty or single-frame input", () => {
    expect(summarizeMotion([])).toEqual({
      meanDiffRatio: 0,
      peakDiffRatio: 0,
    });
    expect(summarizeMotion([solid(0)])).toEqual({
      meanDiffRatio: 0,
      peakDiffRatio: 0,
    });
  });

  it("reports no motion for identical consecutive frames", () => {
    expect(summarizeMotion([solid(10), solid(10), solid(10)])).toEqual({
      meanDiffRatio: 0,
      peakDiffRatio: 0,
    });
  });

  it("averages the changes between consecutive samples and keeps the peak", () => {
    const frames = [solid(0), solid(255), solid(255)];
    expect(summarizeMotion(frames)).toEqual({
      meanDiffRatio: 0.5,
      peakDiffRatio: 1,
    });
  });
});

describe("clipFromBox", () => {
  it("takes the left 60% of the video for the game screen", () => {
    const clip = clipFromBox(
      { x: 100, y: 50, width: 1000, height: 400 },
      GAME_CLIP,
    );
    expect(clip).toEqual({ x: 100, y: 50, width: 600, height: 400 });
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
