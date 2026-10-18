import { describe, expect, it } from "bun:test";
import {
  isWatchPageReadable,
  judgePictureMotion,
  type PictureMotion,
  type PlayableVideo,
  startVideoPlayback,
  toDisplayedStatistics,
  type WatchPageRawReading,
} from "./watchPageBrowser";

const motion = (overrides: Partial<PictureMotion> = {}): PictureMotion => ({
  comparedFrames: 60,
  changedFrames: 30,
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

  it("reads a picture under the still threshold as still", () => {
    // ~0.3 changed fps: the composite stopped changing.
    expect(judgePictureMotion(motion({ changedFrames: 1 }))).toBe("still");
    expect(judgePictureMotion(motion({ changedFrames: 0 }))).toBe("still");
  });

  it("treats a picture just above the still threshold as moving", () => {
    // 4 changed frames in 3s ~ 1.3 fps < 立ったか borderline?
    expect(judgePictureMotion(motion({ changedFrames: 6 }))).toBe("moving");
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

describe("startVideoPlayback", () => {
  const playable = (
    play: () => unknown,
    muted = false,
  ): PlayableVideo & { muted: boolean } => ({ muted, play });

  it("mutes and starts every element", async () => {
    const played: number[] = [];
    const videos = [
      playable(() => {
        played.push(1);
      }),
      playable(() => {
        played.push(2);
      }),
    ];

    startVideoPlayback(videos);
    await Promise.resolve();

    // A muted element is allowed to autoplay without a user gesture; an
    // element left paused is never selected by the motion sampler.
    expect(videos.every((video) => video.muted)).toBe(true);
    expect(played).toEqual([1, 2]);
  });

  it("ignores a play() that rejects", () => {
    const video = playable(() => Promise.reject(new Error("blocked")));
    expect(() => startVideoPlayback([video])).not.toThrow();
  });

  it("ignores a play() that throws synchronously", () => {
    const video = playable(() => {
      throw new Error("no element");
    });
    expect(() => startVideoPlayback([video])).not.toThrow();
  });

  it("accepts an empty collection", () => {
    expect(() => startVideoPlayback([])).not.toThrow();
  });
});
