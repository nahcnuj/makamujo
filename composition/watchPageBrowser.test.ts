import { describe, expect, it } from "bun:test";
import { isCapturableMediaSource } from "../scripts/check-stream";
import {
  CLOCK_ADVANCE_MIN_SECONDS,
  isAnyPlayerAdvertisementPlaying,
  isOnAirFromClock,
  isPlayerAdvertisement,
  isWatchPageReadable,
  judgePictureMotion,
  type PictureMotion,
  type PlayableVideo,
  startVideoPlayback,
  toDisplayedStatistics,
  type WatchPageRawReading,
  type WatchPageVideoState,
  waitForAdvertisementEnd,
} from "./watchPageBrowser";

const motion = (overrides: Partial<PictureMotion> = {}): PictureMotion => ({
  comparedFrames: 60,
  changedFrames: 100,
  windowMs: 3_000,
  tainted: false,
  sawAdvertisement: false,
  clockAdvancedSeconds: 3,
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
    expect(judgePictureMotion(motion({ changedFrames: 100 }))).toBe("moving");
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

  it("discards windows that compared too few frames with motion", () => {
    expect(
      judgePictureMotion(motion({ comparedFrames: 3, changedFrames: 2 })),
    ).toBeUndefined();
  });

  it("reads a frozen picture as still even with few compared frames", () => {
    expect(
      judgePictureMotion(motion({ comparedFrames: 1, changedFrames: 0 })),
    ).toBe("still");
  });
});

describe("isOnAirFromClock", () => {
  it("reads an advancing media clock as on air even when the picture is still", () => {
    // 合成出力が固まっていても hls.js はセグメントを再生し続けるので clock は
    // 進む。これが本物の停止を放映中と判断する根拠（issue #929/#933）。
    expect(
      isOnAirFromClock(motion({ changedFrames: 0, clockAdvancedSeconds: 3 })),
    ).toBe(true);
  });

  it("reads a frozen media clock as off air", () => {
    // 番組終了後の一枚絵 / paused の `<video>` は clock が進まない。
    expect(isOnAirFromClock(motion({ clockAdvancedSeconds: 0 }))).toBe(false);
  });

  it("requires the clock to clear the minimum advance", () => {
    expect(
      isOnAirFromClock(
        motion({ clockAdvancedSeconds: CLOCK_ADVANCE_MIN_SECONDS }),
      ),
    ).toBe(false);
    expect(
      isOnAirFromClock(
        motion({ clockAdvancedSeconds: CLOCK_ADVANCE_MIN_SECONDS + 0.01 }),
      ),
    ).toBe(true);
  });

  it("reads a totally frozen picture as on air even when the clock stopped", () => {
    // HLS が固まったときは clock も止まる。1 枚も動いていなければ合成出力
    // の停止なので、回復のために放送中とみなす。
    expect(
      isOnAirFromClock(
        motion({
          changedFrames: 0,
          comparedFrames: 60,
          clockAdvancedSeconds: 0,
        }),
      ),
    ).toBe(true);
  });

  it("reads a picture with a trickle of motion as on air when the clock stopped", () => {
    // 合成出力が固まっていても、わずかな微動があっても still と判定される
    // 絵は放映中の停止として扱う（issue #992 の再適用）。
    expect(
      isOnAirFromClock(
        motion({
          changedFrames: 1,
          comparedFrames: 60,
          clockAdvancedSeconds: 0,
        }),
      ),
    ).toBe(true);
  });

  it("cannot judge a picture that was never compared", () => {
    expect(
      isOnAirFromClock(
        motion({
          changedFrames: 0,
          comparedFrames: 0,
          clockAdvancedSeconds: 0,
        }),
      ),
    ).toBe(false);
  });

  it("cannot judge a measurement that is missing", () => {
    expect(isOnAirFromClock(undefined)).toBeUndefined();
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

describe("isPlayerAdvertisement", () => {
  const origin = "https://live.nicovideo.jp";
  /** 2026-10-20 の実測で、配信ページの広告面に出ていたクロスオリジンの広告。 */
  const adSource = "https://gcdn.2mdn.net/videoplayback/id/21b88b";
  const programSource = "blob:https://live.nicovideo.jp/44230e76-2c6d";
  const state = (
    overrides: Partial<WatchPageVideoState> = {},
  ): WatchPageVideoState => ({
    source: adSource,
    playing: true,
    sized: true,
    inAdContainer: false,
    ...overrides,
  });

  it("counts a cross-origin advertisement that took over the player", () => {
    // プリロール / 中割り広告はプレイヤー側に差し込まれ、配信映像を止める。
    expect(
      isPlayerAdvertisement(state(), origin, isCapturableMediaSource),
    ).toBe(true);
  });

  it("does not count the sticky advertisement beside the player", () => {
    // `___ad-sticky-video___` の常設広告は、ページを開いている間ずっと再生され
    // 続ける（2026-10-20 に 95 秒以上の連続再生を実測）。これを広告と数えると
    // 測定は毎窓 `sawAdvertisement` になり、回復ラングが一度も走らない
    // （issue #946）。
    expect(
      isPlayerAdvertisement(
        state({ inAdContainer: true }),
        origin,
        isCapturableMediaSource,
      ),
    ).toBe(false);
  });

  it("does not count the program video", () => {
    expect(
      isPlayerAdvertisement(
        state({ source: programSource }),
        origin,
        isCapturableMediaSource,
      ),
    ).toBe(false);
    expect(
      isPlayerAdvertisement(
        state({ source: "", inAdContainer: true }),
        origin,
        isCapturableMediaSource,
      ),
    ).toBe(false);
  });

  it("does not count a paused or unsized element", () => {
    expect(
      isPlayerAdvertisement(
        state({ playing: false }),
        origin,
        isCapturableMediaSource,
      ),
    ).toBe(false);
    expect(
      isPlayerAdvertisement(
        state({ sized: false }),
        origin,
        isCapturableMediaSource,
      ),
    ).toBe(false);
  });
});

describe("isAnyPlayerAdvertisementPlaying", () => {
  const origin = "https://live.nicovideo.jp";
  const program = (): WatchPageVideoState => ({
    source: "blob:https://live.nicovideo.jp/44230e76-2c6d",
    playing: true,
    sized: true,
    inAdContainer: false,
  });
  const stickyAd = (): WatchPageVideoState => ({
    source: "https://gcdn.2mdn.net/videoplayback/id/21b88b",
    playing: true,
    sized: true,
    inAdContainer: true,
  });

  it("ignores the sticky advertisement while the program plays", () => {
    // 実際のページの並び（常設広告 + 配信中継）を再現する。
    expect(
      isAnyPlayerAdvertisementPlaying(
        [stickyAd(), program()],
        origin,
        isCapturableMediaSource,
      ),
    ).toBe(false);
  });

  it("detects a pre-roll that replaced the player", () => {
    expect(
      isAnyPlayerAdvertisementPlaying(
        [
          stickyAd(),
          {
            source: "https://example.com/preroll.mp4",
            playing: true,
            sized: true,
            inAdContainer: false,
          },
        ],
        origin,
        isCapturableMediaSource,
      ),
    ).toBe(true);
  });

  it("reports nothing for a page with only the program", () => {
    expect(
      isAnyPlayerAdvertisementPlaying(
        [program()],
        origin,
        isCapturableMediaSource,
      ),
    ).toBe(false);
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
