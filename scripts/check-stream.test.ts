import { describe, expect, it } from "bun:test";
import {
  didAudioDecodedBytesReset,
  formatJst,
  GAME_MIN_CHANGE_RATIO,
  isAudioPlaying,
  isCapturableMediaSource,
  isChangeRatioAboveThreshold,
  isInAdContainer,
  isMeasurementUnusable,
  isOverallOk,
  isVideoReady,
  type MotionSample,
  type MotionSamples,
  type PlaybackMeasurement,
  shouldReMeasure,
  summarizeMotion,
  toErrorResult,
  VIDEO_MIN_CHANGE_RATIO,
  type VideoState,
  wasAdvertisementShown,
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

describe("video and game change-ratio thresholds", () => {
  it("uses a 0.2 change ratio for both the whole video and the game screen", () => {
    // Absolute FPS thresholds misfired on the CI runner: headless Chromium
    // throttles requestAnimationFrame to ~10 fps with dips to 1-2 fps even
    // on a healthy, moving picture (issue #822), so the verdict judges the
    // fraction of captured frames that changed instead.
    expect(VIDEO_MIN_CHANGE_RATIO).toBe(0.2);
    expect(GAME_MIN_CHANGE_RATIO).toBe(0.2);
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

describe("isChangeRatioAboveThreshold", () => {
  it("treats the threshold itself as an error", () => {
    expect(isChangeRatioAboveThreshold(0.2, VIDEO_MIN_CHANGE_RATIO)).toBe(
      false,
    );
    expect(isChangeRatioAboveThreshold(0.2, GAME_MIN_CHANGE_RATIO)).toBe(false);
  });

  it("passes only when the minimum change ratio exceeds the threshold", () => {
    expect(isChangeRatioAboveThreshold(0.21, VIDEO_MIN_CHANGE_RATIO)).toBe(
      true,
    );
    expect(isChangeRatioAboveThreshold(0, GAME_MIN_CHANGE_RATIO)).toBe(false);
    expect(isChangeRatioAboveThreshold(1, GAME_MIN_CHANGE_RATIO)).toBe(true);
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

describe("summarizeMotion", () => {
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

  it("reports zero ratio and fps for empty or still input", () => {
    expect(summarizeMotion([], (s) => s.wholeChanged, 1000, 10000)).toEqual({
      minChangeRatio: 0,
      avgChangeRatio: 0,
      minFps: 0,
      avgFps: 0,
      changedFrames: 0,
      comparedFrames: 0,
      emptyBucketCount: 10,
    });
    const still = steadySamples(10000, 100).map((s) => ({
      ...s,
      wholeChanged: false,
    }));
    expect(summarizeMotion(still, (s) => s.wholeChanged, 1000, 10000)).toEqual({
      minChangeRatio: 0,
      avgChangeRatio: 0,
      minFps: 0,
      avgFps: 0,
      changedFrames: 0,
      comparedFrames: 100,
      emptyBucketCount: 0,
    });
  });

  it("measures a full change ratio for one changed frame every 100ms", () => {
    const summary = summarizeMotion(
      steadySamples(10000, 100),
      (s) => s.wholeChanged,
      1000,
      10000,
    );
    expect(summary.minChangeRatio).toBe(1);
    expect(summary.avgChangeRatio).toBe(1);
    expect(summary.minFps).toBe(10);
    expect(summary.avgFps).toBe(10);
    expect(summary.changedFrames).toBe(100);
    expect(summary.comparedFrames).toBe(100);
    expect(summary.emptyBucketCount).toBe(0);
  });

  it("exposes a one-second freeze as a zero minimum ratio", () => {
    const samples = steadySamples(10000, 100).map((s) =>
      s.elapsedMs >= 4000 && s.elapsedMs < 5000
        ? { ...s, wholeChanged: false }
        : s,
    );
    const summary = summarizeMotion(
      samples,
      (s) => s.wholeChanged,
      1000,
      10000,
    );
    expect(summary.minChangeRatio).toBe(0);
    expect(summary.avgChangeRatio).toBe(0.9);
    expect(summary.minFps).toBe(0);
    expect(summary.avgFps).toBe(9);
    expect(summary.changedFrames).toBe(90);
  });

  it("summarises a single region picked from each sample", () => {
    const samples = steadySamples(10000, 100).map((s, index) => ({
      ...s,
      gameChanged: index % 2 === 0,
    }));
    const summary = summarizeMotion(samples, (s) => s.gameChanged, 1000, 10000);
    expect(summary.minChangeRatio).toBe(0.5);
    expect(summary.avgChangeRatio).toBe(0.5);
    expect(summary.minFps).toBe(5);
    expect(summary.avgFps).toBe(5);
    expect(summary.changedFrames).toBe(50);
  });

  it("ignores samples recorded past the window", () => {
    const samples = [...steadySamples(10000, 100), sample(12000, true)];
    const summary = summarizeMotion(
      samples,
      (s) => s.wholeChanged,
      1000,
      10000,
    );
    expect(summary.changedFrames).toBe(100);
    expect(summary.comparedFrames).toBe(100);
  });

  it("excludes buckets that captured no frames from the minimum", () => {
    // requestAnimationFrame starvation (headless Chromium on a loaded CI
    // runner) leaves silent buckets. They say nothing about the stream, so
    // they must not drag the minimum to zero the way the old absolute-FPS
    // summary did.
    const samples = steadySamples(3000, 100);
    const summary = summarizeMotion(
      samples,
      (s) => s.wholeChanged,
      1000,
      10000,
    );
    expect(summary.emptyBucketCount).toBe(7);
    expect(summary.minChangeRatio).toBe(1);
    expect(summary.minFps).toBe(10);
  });

  it("passes a starved window whose frames all still changed (issue #822)", () => {
    // Observed on a healthy stream: the page presented only ~9-10 frames per
    // second and one second dipped to two frames, so the minimum absolute FPS
    // (2) fell far below the old 24 FPS threshold even though every captured
    // frame differed from its predecessor. Ratio-based judgement passes it.
    const samples: MotionSample[] = [];
    for (let t = 0; t < 10000; t += 100) {
      if (t >= 4000 && t < 5000) continue;
      samples.push(sample(t, true));
    }
    samples.push(sample(4500, true), sample(4800, true));
    const summary = summarizeMotion(
      samples,
      (s) => s.wholeChanged,
      1000,
      10000,
    );
    expect(summary.minFps).toBe(2);
    expect(summary.minChangeRatio).toBe(1);
    expect(
      isChangeRatioAboveThreshold(
        summary.minChangeRatio,
        VIDEO_MIN_CHANGE_RATIO,
      ),
    ).toBe(true);
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
