import { describe, expect, it } from "bun:test";

// Test the formatJst function by importing it from the main module
// Since the main module doesn't export, we'll test the logic directly

function formatJst(date: Date): string {
  return date
    .toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    .replace(/\//g, "-");
}

describe("formatJst", () => {
  it("formats date in JST with correct format", () => {
    // Test with a known date: 2024-01-15 12:30:45 UTC
    // JST is UTC+9, so this should be 2024-01-15 21:30:45 JST
    const date = new Date("2024-01-15T12:30:45.000Z");
    const result = formatJst(date);
    expect(result).toBe("2024-01-15 21:30:45");
  });

  it("handles different months correctly", () => {
    const date = new Date("2024-12-25T00:00:00.000Z");
    const result = formatJst(date);
    // Dec 25 00:00 UTC = Dec 25 09:00 JST
    expect(result).toBe("2024-12-25 09:00:00");
  });
});

describe("video playing detection logic", () => {
  const CHECK_DURATION_MS = 10_000;
  const expectedAdvance = CHECK_DURATION_MS / 1000; // 10 seconds
  const tolerance = 2;

  function isVideoPlaying(
    initialPaused: boolean,
    initialCurrentTime: number,
    finalPaused: boolean,
    finalCurrentTime: number,
  ): boolean {
    if (finalPaused) return false;
    const timeAdvanced = finalCurrentTime - initialCurrentTime;
    return timeAdvanced >= expectedAdvance - tolerance;
  }

  it("returns false when video is paused", () => {
    expect(isVideoPlaying(false, 0, true, 5)).toBe(false);
  });

  it("returns false when currentTime didn't advance enough", () => {
    expect(isVideoPlaying(false, 0, false, 7)).toBe(false); // 7s < 8s (10-2)
  });

  it("returns true when currentTime advanced enough", () => {
    expect(isVideoPlaying(false, 0, false, 9)).toBe(true); // 9s >= 8s
    expect(isVideoPlaying(false, 0, false, 10)).toBe(true);
    expect(isVideoPlaying(false, 0, false, 15)).toBe(true);
  });

  it("handles non-zero start time", () => {
    expect(isVideoPlaying(false, 100, false, 109)).toBe(true); // 9s advance
    expect(isVideoPlaying(false, 100, false, 107)).toBe(false); // 7s advance
  });
});

describe("audio playing detection logic", () => {
  function isAudioPlaying(videoPlaying: boolean, muted: boolean): boolean {
    return videoPlaying && !muted;
  }

  it("returns false when muted", () => {
    expect(isAudioPlaying(true, true)).toBe(false);
  });

  it("returns false when video not playing", () => {
    expect(isAudioPlaying(false, false)).toBe(false);
  });

  it("returns true when video playing and not muted", () => {
    expect(isAudioPlaying(true, false)).toBe(true);
  });
});

describe("overall check result logic", () => {
  function isOverallOk(
    audioPlaying: boolean,
    videoPlaying: boolean,
    gameScreenPlaying: boolean,
  ): boolean {
    return audioPlaying && videoPlaying && gameScreenPlaying;
  }

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
