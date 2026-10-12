import { describe, expect, it } from "bun:test";
import {
  calculateDiffRatio,
  clipFromBox,
  formatJst,
  GAME_CLIP,
  isAudioPlaying,
  isOverallOk,
  isPictureMoving,
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
  it("returns 0 for identical buffers", () => {
    const buf1 = Buffer.from([1, 2, 3, 4]);
    const buf2 = Buffer.from([1, 2, 3, 4]);
    expect(calculateDiffRatio(buf1, buf2)).toBe(0);
  });

  it("returns 1 for completely different buffers", () => {
    const buf1 = Buffer.from([1, 2, 3, 4]);
    const buf2 = Buffer.from([5, 6, 7, 8]);
    expect(calculateDiffRatio(buf1, buf2)).toBe(1);
  });

  it("returns ratio for partially different buffers", () => {
    const buf1 = Buffer.from([1, 2, 3, 4]);
    const buf2 = Buffer.from([1, 2, 5, 6]);
    expect(calculateDiffRatio(buf1, buf2)).toBe(0.5);
  });

  it("returns 1 for buffers of different lengths", () => {
    const buf1 = Buffer.from([1, 2, 3]);
    const buf2 = Buffer.from([1, 2, 3, 4]);
    expect(calculateDiffRatio(buf1, buf2)).toBe(1);
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
