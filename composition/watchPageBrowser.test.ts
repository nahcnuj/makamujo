import { describe, expect, it } from "bun:test";
import {
  isWatchPageReadable,
  judgePictureMotion,
  type MeasurableVideoLike,
  type PictureMotion,
  type PlayableVideo,
  selectMeasurableVideo,
  startVideoPlayback,
  toDisplayedStatistics,
  type WatchPageRawReading,
  waitForAdvertisementEnd,
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

describe("waitForAdvertisementEnd", () => {
  /** A controllable clock + sleep so the wait does not run in real time. */
  const createClock = () => {
    let currentMs = 0;
    const sleeps: number[] = [];
    return {
      now: () => currentMs,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        currentMs += ms;
      },
      sleeps,
    };
  };

  it("returns immediately when no advertisement is playing", async () => {
    const clock = createClock();
    let probes = 0;

    const ended = await waitForAdvertisementEnd({
      isAdvertisementPlaying: async () => {
        probes += 1;
        return false;
      },
      timeoutMs: 1_000,
      pollMs: 100,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(ended).toBe(true);
    expect(probes).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("waits while an advertisement plays and returns true once it ends", async () => {
    const clock = createClock();
    // Playing for the first three probes, then finished.
    const answers = [true, true, true, false];
    let probes = 0;

    const ended = await waitForAdvertisementEnd({
      isAdvertisementPlaying: async () => {
        const answer = answers[probes] ?? false;
        probes += 1;
        return answer;
      },
      timeoutMs: 10_000,
      pollMs: 100,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(ended).toBe(true);
    expect(probes).toBe(4);
    // Polled at the configured gap until the advertisement ended.
    expect(clock.sleeps).toEqual([100, 100, 100]);
  });

  it("gives up after the timeout and reports the advertisement still playing", async () => {
    const clock = createClock();

    const ended = await waitForAdvertisementEnd({
      isAdvertisementPlaying: async () => true,
      timeoutMs: 250,
      pollMs: 100,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(ended).toBe(false);
    // The deadline is checked after each probe, so it overshoots by at most
    // one poll gap rather than polling forever.
    expect(clock.sleeps).toEqual([100, 100, 100]);
  });
});

describe("selectMeasurableVideo", () => {
  const video = (
    overrides: Partial<MeasurableVideoLike> & { tag: string },
  ): MeasurableVideoLike & { tag: string } => ({
    paused: false,
    videoWidth: 1_280,
    readyState: 4,
    ...overrides,
  });

  it("prefers a playing, sized video over a paused one", () => {
    const playing = video({ tag: "playing" });
    const paused = video({ paused: true, tag: "paused" });
    expect(selectMeasurableVideo([paused, playing])?.tag).toBe("playing");
  });

  it("falls back to a sized-but-paused video", () => {
    // Regression: the composite-freeze measurement needs this fallback. When the
    // delivered picture stalls, the watch page's <video> can pause/buffer;
    // without the fallback the window came back empty, judged `unknown`, and the
    // freeze streak reset every cycle so recovery never escalated.
    const paused = video({ paused: true, tag: "paused" });
    expect(selectMeasurableVideo([paused])?.tag).toBe("paused");
  });

  it("ignores videos with no decoded frame", () => {
    const unsized = video({ videoWidth: 0, tag: "unsized" });
    const loading = video({ readyState: 1, tag: "loading" });
    expect(selectMeasurableVideo([unsized, loading])).toBeUndefined();
  });

  it("returns undefined when there is nothing to measure", () => {
    expect(selectMeasurableVideo([])).toBeUndefined();
  });

  it("prefers a sized video over a paused one with no frame", () => {
    const unsized = video({ paused: true, videoWidth: 0, tag: "unsized" });
    const sized = video({ paused: true, tag: "sized" });
    expect(selectMeasurableVideo([unsized, sized])?.tag).toBe("sized");
  });
});
