import { describe, expect, it } from "bun:test";
import {
  didAudioDecodedBytesReset,
  type FpsSummary,
  formatJst,
  GAME_MIN_FPS,
  isAudioPlaying,
  isCapturableMediaSource,
  isFpsAboveThreshold,
  isInAdContainer,
  isMeasurementUnusable,
  isOverallOk,
  isVideoReady,
  judgeMotion,
  type MotionSample,
  type MotionSamples,
  mergeMotionVerdicts,
  type PlaybackMeasurement,
  shouldReMeasure,
  summarizeFps,
  toErrorResult,
  VIDEO_MIN_FPS,
  type VideoState,
  wasAdvertisementShown,
  worseFps,
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

describe("didAudioDecodedBytesReset", () => {
  it("flags a counter that went backwards (the element was replaced)", () => {
    // Observed when the player rebuilt its media element mid-check:
    // the start and end probes watched different elements.
    expect(didAudioDecodedBytesReset(14129, 7690)).toBe(true);
  });

  it("accepts a counter that held still or advanced", () => {
    expect(didAudioDecodedBytesReset(0, 0)).toBe(false);
    expect(didAudioDecodedBytesReset(100, 100)).toBe(false);
    expect(didAudioDecodedBytesReset(100, 250)).toBe(false);
  });
});

describe("shouldReMeasure", () => {
  const motionOf = (
    tainted: boolean,
    samples: MotionSample[],
  ): MotionSamples => ({
    tainted,
    elapsedMs: 10_000,
    samples,
    sawAdvertisement: false,
  });
  const twoSamples: MotionSample[] = [
    { elapsedMs: 0, wholeChanged: true, gameChanged: true },
    { elapsedMs: 16, wholeChanged: true, gameChanged: true },
  ];

  it("accepts a window with enough frames and a stable counter", () => {
    expect(shouldReMeasure(motionOf(false, twoSamples), 0, 100)).toBe(false);
  });

  it("rejects a window that captured too few frames", () => {
    expect(shouldReMeasure(motionOf(false, []), 0, 100)).toBe(true);
    const oneSample: MotionSample[] = [
      { elapsedMs: 0, wholeChanged: true, gameChanged: true },
    ];
    expect(shouldReMeasure(motionOf(false, oneSample), 0, 100)).toBe(true);
  });

  it("rejects a window whose canvas read failed", () => {
    expect(shouldReMeasure(motionOf(true, twoSamples), 0, 100)).toBe(true);
  });

  it("rejects a window whose decoded-audio counter went backwards", () => {
    expect(shouldReMeasure(motionOf(false, twoSamples), 14129, 7690)).toBe(
      true,
    );
  });
});

describe("isMeasurementUnusable", () => {
  const probe = (decodedAudioBytes: number): VideoState => ({
    found: true,
    videoWidth: 640,
    readyState: 2,
    paused: false,
    currentTime: 0,
    decodedAudioBytes,
  });
  const motionOf = (
    tainted: boolean,
    samples: MotionSample[],
  ): MotionSamples => ({
    tainted,
    elapsedMs: 10_000,
    samples,
    sawAdvertisement: false,
  });
  const twoSamples: MotionSample[] = [
    { elapsedMs: 0, wholeChanged: true, gameChanged: true },
    { elapsedMs: 16, wholeChanged: true, gameChanged: true },
  ];
  const measurementOf = (
    motion: MotionSamples,
    decodedAudioBytesStart: number,
    decodedAudioBytesEnd: number,
  ): PlaybackMeasurement => ({
    startProbe: probe(decodedAudioBytesStart),
    motion,
    endProbe: probe(decodedAudioBytesEnd),
  });

  it("rejects a window whose closing probe found no video", () => {
    // The live element was replaced by an advertisement (cross-origin) or
    // the player rebuilt it, so the window cannot be judged.
    expect(isMeasurementUnusable(null)).toBe(true);
  });

  it("accepts a window with enough frames and a stable counter", () => {
    expect(
      isMeasurementUnusable(measurementOf(motionOf(false, twoSamples), 0, 100)),
    ).toBe(false);
  });

  it("rejects a window that captured too few frames", () => {
    expect(
      isMeasurementUnusable(measurementOf(motionOf(false, []), 0, 100)),
    ).toBe(true);
  });

  it("rejects a window whose canvas read failed", () => {
    expect(
      isMeasurementUnusable(measurementOf(motionOf(true, twoSamples), 0, 100)),
    ).toBe(true);
  });

  it("rejects a window whose decoded-audio counter went backwards", () => {
    expect(
      isMeasurementUnusable(
        measurementOf(motionOf(false, twoSamples), 14129, 7690),
      ),
    ).toBe(true);
  });
});

describe("wasAdvertisementShown", () => {
  const motionOf = (sawAdvertisement: boolean): MotionSamples => ({
    tainted: false,
    elapsedMs: 10_000,
    samples: [{ elapsedMs: 0, wholeChanged: false, gameChanged: false }],
    sawAdvertisement,
  });

  it("flags a window during which an advertisement played", () => {
    // A signed-out viewer gets pre-roll/mid-roll ads, and the live picture is
    // frozen while one plays, so the recorded motion does not describe the
    // program and the window must be discarded.
    expect(wasAdvertisementShown(motionOf(true))).toBe(true);
  });

  it("accepts a window with no advertisement", () => {
    expect(wasAdvertisementShown(motionOf(false))).toBe(false);
  });
});

describe("isMeasurementUnusable and advertisements", () => {
  // An advertisement is not a reason to reload the player (a reload triggers
  // a fresh pre-roll ad), so `isMeasurementUnusable` deliberately ignores it;
  // the caller waits the ad out using `wasAdvertisementShown` instead.
  it("does not treat an advertisement alone as unusable", () => {
    const measurement: PlaybackMeasurement = {
      startProbe: {
        found: true,
        videoWidth: 640,
        readyState: 2,
        paused: false,
        currentTime: 0,
        decodedAudioBytes: 0,
      },
      motion: {
        tainted: false,
        elapsedMs: 10_000,
        samples: [
          { elapsedMs: 0, wholeChanged: false, gameChanged: false },
          { elapsedMs: 16, wholeChanged: false, gameChanged: false },
        ],
        sawAdvertisement: true,
      },
      endProbe: {
        found: true,
        videoWidth: 640,
        readyState: 2,
        paused: false,
        currentTime: 10,
        decodedAudioBytes: 100,
      },
    };
    expect(isMeasurementUnusable(measurement)).toBe(false);
  });
});

describe("video and game FPS thresholds", () => {
  it("uses 24 fps for the whole video and 8 fps for the game screen", () => {
    expect(VIDEO_MIN_FPS).toBe(24);
    expect(GAME_MIN_FPS).toBe(8);
  });
});

describe("isVideoReady", () => {
  const advancing = { videoWidth: 640, readyState: 2, paused: false };

  it("rejects a player that has not decoded a frame yet", () => {
    // Right after waitForSelector("video") the element is attached but empty.
    expect(isVideoReady({ ...advancing, videoWidth: 0 })).toBe(false);
    expect(isVideoReady({ ...advancing, readyState: 1 })).toBe(false);
    expect(isVideoReady({ ...advancing, readyState: 0 })).toBe(false);
  });

  it("rejects a paused player", () => {
    expect(isVideoReady({ ...advancing, paused: true })).toBe(false);
  });

  it("accepts a decoded, advancing player", () => {
    expect(isVideoReady(advancing)).toBe(true);
    expect(isVideoReady({ ...advancing, readyState: 4 })).toBe(true);
    expect(isVideoReady({ ...advancing, videoWidth: 1280 })).toBe(true);
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

describe("isCapturableMediaSource", () => {
  const origin = "https://live.nicovideo.jp";

  it("accepts the same-origin blob stream", () => {
    expect(
      isCapturableMediaSource(
        "blob:https://live.nicovideo.jp/5ff1666b-b664-423f-a456-00051a39e9e8",
        origin,
      ),
    ).toBe(true);
  });

  it("rejects a cross-origin advertisement video", () => {
    // Observed on the watch page: a mid-stream ad is a plain cross-origin
    // file, and drawing it taints the sampling canvas.
    expect(
      isCapturableMediaSource(
        "https://gcdn.2mdn.net/videoplayback/id/21b88bf5e807721e/itag/344/source/web_video_ads/file.mp4",
        origin,
      ),
    ).toBe(false);
  });

  it("accepts an element that has not loaded a source yet", () => {
    expect(isCapturableMediaSource("", origin)).toBe(true);
  });

  it("accepts a same-origin http source", () => {
    expect(
      isCapturableMediaSource(
        "https://live.nicovideo.jp/assets/sample.mp4",
        origin,
      ),
    ).toBe(true);
  });

  it("accepts data and mediastream sources", () => {
    expect(isCapturableMediaSource("data:video/mp4;base64,AAAA", origin)).toBe(
      true,
    );
    expect(isCapturableMediaSource("mediastream:abc", origin)).toBe(true);
  });

  it("rejects an unparseable source", () => {
    expect(isCapturableMediaSource("http://[invalid", origin)).toBe(false);
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

describe("isInAdContainer", () => {
  it("flags sticky advertisement surfaces", () => {
    expect(isInAdContainer("___ad-sticky-video___KZcuJ")).toBe(true);
    expect(isInAdContainer("_ap_apex_ad")).toBe(true);
    expect(isInAdContainer("apex")).toBe(true);
  });

  it("accepts the live program surface", () => {
    expect(isInAdContainer("___dlive-player___J_ZVV")).toBe(false);
    expect(isInAdContainer("___video___mddiR")).toBe(false);
    expect(isInAdContainer(null)).toBe(false);
    expect(isInAdContainer(undefined)).toBe(false);
  });
});

describe("judgeMotion", () => {
  const motionOf = (
    samples: MotionSample[],
    { tainted = false, sawAdvertisement = false } = {},
  ): MotionSamples => ({
    tainted,
    elapsedMs: 10_000,
    samples,
    sawAdvertisement,
  });

  /** One changed frame every `intervalMs` for the whole window. */
  const steadySamples = (intervalMs: number, windowMs: number) => {
    const samples: MotionSample[] = [];
    for (let t = 0; t < windowMs; t += intervalMs) {
      samples.push({ elapsedMs: t, wholeChanged: true, gameChanged: true });
    }
    return samples;
  };

  it("passes a healthy window whose every bucket exceeds both thresholds", () => {
    // 30 fps picture: the whole-video threshold (24) and the game threshold
    // (8) are both cleared in every one-second bucket.
    const verdict = judgeMotion(
      motionOf(steadySamples(33, 10_000)),
      1_000,
      10_000,
    );
    expect(verdict.videoPlaying).toBe(true);
    expect(verdict.gameScreenPlaying).toBe(true);
    expect(verdict.videoFps?.minFps).toBeGreaterThan(VIDEO_MIN_FPS);
    expect(verdict.gameFps?.minFps).toBeGreaterThan(GAME_MIN_FPS);
  });

  it("fails both regions when the picture is frozen for the whole window", () => {
    const still = steadySamples(33, 10_000).map((sample) => ({
      ...sample,
      wholeChanged: false,
      gameChanged: false,
    }));
    const verdict = judgeMotion(motionOf(still), 1_000, 10_000);
    expect(verdict.videoPlaying).toBe(false);
    expect(verdict.gameScreenPlaying).toBe(false);
    expect(verdict.videoFps?.minFps).toBe(0);
    expect(verdict.gameFps?.minFps).toBe(0);
  });

  it("fails the game region alone when only the game picture freezes", () => {
    // The whole picture keeps moving from the streamer panel, but the game
    // region holds still for one whole second.
    const samples = steadySamples(33, 10_000).map((sample) =>
      sample.elapsedMs >= 4_000 && sample.elapsedMs < 5_000
        ? { ...sample, gameChanged: false }
        : sample,
    );
    const verdict = judgeMotion(motionOf(samples), 1_000, 10_000);
    expect(verdict.videoPlaying).toBe(true);
    expect(verdict.gameScreenPlaying).toBe(false);
  });

  it("fails when a single bucket stalls, even if the rest of the window was healthy", () => {
    // The window shape seen in issue #818: the picture moved most of the
    // time but one second nearly froze. A single stalled bucket is below
    // both thresholds, so one window alone cannot claim the stream "kept"
    // stopping; the caller has to confirm on a second window.
    const samples = steadySamples(33, 10_000).map((sample) =>
      sample.elapsedMs >= 4_000 && sample.elapsedMs < 5_000
        ? { ...sample, wholeChanged: false, gameChanged: false }
        : sample,
    );
    const verdict = judgeMotion(motionOf(samples), 1_000, 10_000);
    expect(verdict.videoPlaying).toBe(false);
    expect(verdict.gameScreenPlaying).toBe(false);
  });

  it("reports no figures for a tainted or too-short window", () => {
    const tainted = judgeMotion(
      motionOf(steadySamples(33, 10_000), { tainted: true }),
      1_000,
      10_000,
    );
    expect(tainted).toEqual({
      videoPlaying: false,
      gameScreenPlaying: false,
      videoFps: null,
      gameFps: null,
    });
    const tooShort = judgeMotion(
      motionOf([{ elapsedMs: 0, wholeChanged: true, gameChanged: true }]),
      1_000,
      10_000,
    );
    expect(tooShort).toEqual({
      videoPlaying: false,
      gameScreenPlaying: false,
      videoFps: null,
      gameFps: null,
    });
  });
});

describe("worseFps", () => {
  const fps = (minFps: number, avgFps = minFps): FpsSummary => ({
    minFps,
    avgFps,
    changedFrames: 0,
    comparedFrames: 0,
  });

  it("falls back to whichever side has figures", () => {
    expect(worseFps(null, null)).toBeNull();
    expect(worseFps(null, fps(30))).toEqual(fps(30));
    expect(worseFps(fps(30), null)).toEqual(fps(30));
  });

  it("picks the slower window", () => {
    const fast = fps(30);
    const slow = fps(1, 16.6);
    expect(worseFps(fast, slow)).toBe(slow);
    expect(worseFps(slow, fast)).toBe(slow);
  });

  it("keeps the first window when both slowed equally", () => {
    const first = fps(10);
    const second = fps(10);
    expect(worseFps(first, second)).toBe(first);
  });
});

describe("mergeMotionVerdicts", () => {
  const verdictOf = (
    videoPlaying: boolean,
    gameScreenPlaying: boolean,
    videoMinFps: number | null,
  ) => ({
    videoPlaying,
    gameScreenPlaying,
    videoFps:
      videoMinFps === null
        ? null
        : {
            minFps: videoMinFps,
            avgFps: videoMinFps,
            changedFrames: 0,
            comparedFrames: 0,
          },
    gameFps:
      videoMinFps === null
        ? null
        : {
            minFps: videoMinFps,
            avgFps: videoMinFps,
            changedFrames: 0,
            comparedFrames: 0,
          },
  });

  it("treats a stall confirmed only by the first window as recovered", () => {
    // Transient stall: the second window shows the picture moving again, so
    // the check must not report the stream as stopped.
    const merged = mergeMotionVerdicts(
      verdictOf(false, false, 1),
      verdictOf(true, true, 30),
    );
    expect(merged.videoPlaying).toBe(true);
    expect(merged.gameScreenPlaying).toBe(true);
  });

  it("fails when every window saw a stalled picture", () => {
    // A genuinely dead stream stays dead across the confirmation window.
    const merged = mergeMotionVerdicts(
      verdictOf(false, false, 1),
      verdictOf(false, false, 0),
    );
    expect(merged.videoPlaying).toBe(false);
    expect(merged.gameScreenPlaying).toBe(false);
  });

  it("reports the slower window's figures so the stall stays visible", () => {
    const merged = mergeMotionVerdicts(
      verdictOf(false, false, 1),
      verdictOf(true, true, 30),
    );
    expect(merged.videoFps?.minFps).toBe(1);
    expect(merged.gameFps?.minFps).toBe(1);
  });
});
