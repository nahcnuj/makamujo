import { describe, expect, it } from "bun:test";
import { VIDEO_MIN_FPS } from "../scripts/check-stream";
import {
  isWatchPageReadable,
  judgePictureMotion,
  PICTURE_FROZEN_FPS_THRESHOLD,
  PICTURE_STILL_FPS_THRESHOLD,
  type PictureMotion,
  toDisplayedStatistics,
  type WatchPageRawReading,
} from "./watchPageBrowser";

/** 60fps でサンプリングして映像も 30fps で動いている健康な窓。 */
const motion = (overrides: Partial<PictureMotion> = {}): PictureMotion => ({
  comparedFrames: 180,
  changedFrames: 90,
  windowMs: 3_000,
  tainted: false,
  sawAdvertisement: false,
  ...overrides,
});

describe("toDisplayedStatistics", () => {
  it("turns the displayed text into numbers", () => {
    expect(
      toDisplayedStatistics({
        statistics: {
          viewers: "25",
          comments: "1,055",
          nicoadPoints: "30",
          giftPoints: "40",
        },
        hasStatisticsRow: true,
      }),
    ).toEqual({
      viewers: 25,
      comments: 1055,
      nicoadPoints: 30,
      giftPoints: 40,
    });
  });

  it("keeps metrics the page shows as a placeholder as no value", () => {
    expect(
      toDisplayedStatistics({
        statistics: {
          viewers: "25",
          comments: "-",
          nicoadPoints: "-",
          giftPoints: "-",
        },
        hasStatisticsRow: true,
      }),
    ).toEqual({
      viewers: 25,
      comments: undefined,
      nicoadPoints: undefined,
      giftPoints: undefined,
    });
  });
});

describe("isWatchPageReadable", () => {
  it("accepts a page that shows the statistics row even with placeholders", () => {
    expect(
      isWatchPageReadable({
        statistics: {
          viewers: "-",
          comments: "-",
          nicoadPoints: "-",
          giftPoints: "-",
        },
        hasStatisticsRow: true,
      }),
    ).toBe(true);
  });

  it("rejects a page without the statistics row", () => {
    const raw: WatchPageRawReading = {
      statistics: {
        viewers: null,
        comments: null,
        nicoadPoints: null,
        giftPoints: null,
      },
      hasStatisticsRow: false,
    };

    expect(isWatchPageReadable(raw)).toBe(false);
  });
});

describe("judgePictureMotion", () => {
  it("reads a changing picture as moving", () => {
    expect(judgePictureMotion(motion())).toBe("moving");
  });

  it("reads a frozen picture as still regardless of the sampling rate", () => {
    // ~0.3 changed fps: the composite stopped changing.
    expect(judgePictureMotion(motion({ changedFrames: 1 }))).toBe("still");
    expect(
      judgePictureMotion(motion({ changedFrames: 0, comparedFrames: 60 })),
    ).toBe("still");
  });

  it("reads a stuttering picture below the health checker's bar as still", () => {
    // 40 changed frames in 3s = 13.3 fps: exactly the windows the hourly
    // checker reports as "映像全体が停止し続けています" (measured 0-21 fps).
    expect(judgePictureMotion(motion({ changedFrames: 40 }))).toBe("still");
  });

  it("does not judge when the sampler cannot resolve the bar", () => {
    // 10 changed fps could be a stuttering stream or a healthy one sampled at
    // 20 fps (changed fps never exceeds the sampling rate): neither.
    expect(
      judgePictureMotion(motion({ changedFrames: 30, comparedFrames: 60 })),
    ).toBeUndefined();
  });

  it("treats a picture exactly at the bar as moving", () => {
    // 72 changed frames in 3s = 24 fps = the bar itself.
    expect(judgePictureMotion(motion({ changedFrames: 72 }))).toBe("moving");
    expect(judgePictureMotion(motion({ changedFrames: 71 }))).toBe("still");
  });

  it("keeps the bar in step with the health checker", () => {
    // scripts/check-stream.ts is not to be modified (issue #807), so the
    // shared value is pinned from this side instead.
    expect(PICTURE_STILL_FPS_THRESHOLD).toBe(VIDEO_MIN_FPS);
    expect(PICTURE_STILL_FPS_THRESHOLD).toBe(24);
    expect(PICTURE_FROZEN_FPS_THRESHOLD).toBe(2);
  });

  it("discards windows during an advertisement without judging", () => {
    expect(
      judgePictureMotion(motion({ sawAdvertisement: true })),
    ).toBeUndefined();
  });

  it("discards tainted windows without judging", () => {
    expect(judgePictureMotion(motion({ tainted: true }))).toBeUndefined();
  });

  it("discards windows too short to judge", () => {
    expect(judgePictureMotion(motion({ windowMs: 500 }))).toBeUndefined();
  });

  it("discards windows that compared too few frames", () => {
    expect(
      judgePictureMotion(motion({ comparedFrames: 3, changedFrames: 0 })),
    ).toBeUndefined();
  });
});
