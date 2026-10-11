import { describe, expect, it } from "bun:test";
import {
  calculateDiffRatio,
  formatJst,
  isAudioPlaying,
  isOverallOk,
  isVideoPlaying,
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

describe("isVideoPlaying", () => {
  const CHECK_DURATION_MS = 10_000;
  const expectedAdvance = CHECK_DURATION_MS / 1000;
  const tolerance = 2;

  it("returns false when video is paused", () => {
    expect(isVideoPlaying(false, 0, true, 5)).toBe(false);
  });

  it("returns false when currentTime didn't advance enough", () => {
    expect(isVideoPlaying(false, 0, false, 7)).toBe(false);
  });

  it("returns true when currentTime advanced enough", () => {
    expect(isVideoPlaying(false, 0, false, 9)).toBe(true);
    expect(isVideoPlaying(false, 0, false, 10)).toBe(true);
    expect(isVideoPlaying(false, 0, false, 15)).toBe(true);
  });

  it("handles non-zero start time", () => {
    expect(isVideoPlaying(false, 100, false, 109)).toBe(true);
    expect(isVideoPlaying(false, 100, false, 107)).toBe(false);
  });
});

describe("isAudioPlaying", () => {
  it("returns false when muted", () => {
    expect(isAudioPlaying(true, true, 1, true)).toBe(false);
  });

  it("returns false when volume is 0", () => {
    expect(isAudioPlaying(true, false, 0, true)).toBe(false);
  });

  it("returns false when no audio tracks", () => {
    expect(isAudioPlaying(true, false, 1, false)).toBe(false);
  });

  it("returns false when video not playing", () => {
    expect(isAudioPlaying(false, false, 1, true)).toBe(false);
  });

  it("returns true when video playing and not muted and volume > 0 and has audio tracks", () => {
    expect(isAudioPlaying(true, false, 1, true)).toBe(true);
  });
});

describe("isOverallOk", () => {
  it("returns false if any check fails", () => {
    expect(isOverallOk(false, true, true)).toBe(false);
    expect(isOverallOk(true, false, true)).toBe(false);
    expect(isOverallOk(true, true, false)).toBe(false);
    expect(isOverallOk(false, false, false)).toBe(false);
  });

  it("returns true only when all checks pass", () => {
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
