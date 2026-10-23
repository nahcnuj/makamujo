import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const WATCH_PAGE_URL = "https://live.nicovideo.jp/watch/user/14171889";
const CHECK_DURATION_MS = 10_000;
const FPS_BUCKET_MS = 1_000;
const NAVIGATION_TIMEOUT_MS = 60_000;
/** The player loads asynchronously; sampling before it does yields no frames. */
const PLAYBACK_READY_TIMEOUT_MS = 30_000;
const PLAYBACK_READY_POLL_MS = 250;
/**
 * Timeout for the in-page motion sampler evaluate call.
 *
 * When the renderer is wedged (compositor not producing frames), the
 * requestAnimationFrame callbacks never fire and the evaluate hangs
 * indefinitely. This timeout ensures the check reports a frozen picture
 * instead of hanging the entire job (issue #982).
 */
const MOTION_EVALUATE_TIMEOUT_MS = CHECK_DURATION_MS + 5_000;
/** Playback has to advance this far before the startup frames are skipped. */
const PLAYBACK_WARMUP_SECONDS = 2;
/**
 * How long to wait for an advertisement to finish. A signed-out viewer gets a
 * pre-roll advertisement on every page load and mid-roll ones while watching;
 * the live `<video>` is frozen for the whole advertisement, so measuring
 * during one reports a healthy stream as stopped. Ads run for tens of seconds,
 * hence the generous bound, but it stays well inside the job's 10-minute
 * timeout even when a reload and a second wait follow.
 */
const ADVERTISEMENT_WAIT_TIMEOUT_MS = 90_000;
const ADVERTISEMENT_POLL_MS = 500;
/**
 * How long to wait for the live `<video>` to become measurable again after an
 * advertisement releases the player.
 *
 * Advertisement teardown re-attaches the live media source a few seconds after
 * the last ad frame (and can leave the element paused). Probing in that gap
 * finds no capturable video, so `measurePlayback` returned `null` and the
 * check reported a healthy stream as "the video element disappeared" — while
 * its reload queued the next pre-roll advertisement and reproduced the very
 * same gap until the retry budget ran out. The bound covers the hand-off plus
 * a little buffering without eating the job's 10-minute timeout.
 */
const PLAYBACK_SETTLE_TIMEOUT_MS = 15_000;
const PLAYBACK_SETTLE_POLL_MS = 250;
/**
 * Maximum retries when a window has to be discarded (advertisement, rebuilt
 * media element, missing video): the measurement is re-taken at most this
 * many times before the check gives up.
 */
const MEASUREMENT_RETRY_LIMIT = 5;
const MAX_SAMPLE_DIMENSION = 128;
const PIXEL_CHANNEL_TOLERANCE = 16;
/** A sampled frame counts as "changed" when this fraction of pixels moved. */
const MIN_CHANGED_RATIO = 0.001;
/** Whole video: minimum moving frames per second over the window. */
export const VIDEO_MIN_FPS = 24;
/** Game panel: minimum moving frames per second over the window. */
export const GAME_MIN_FPS = 8;

/** Left 60% of the video: game panel on the 10×8 layout. */
export const GAME_CLIP = {
  xRatio: 0,
  yRatio: 0,
  widthRatio: 0.6,
  heightRatio: 1,
} as const;

declare global {
  interface Window {
    /**
     * Installed by {@link SELECT_VIDEO_INIT_SCRIPT}; returns the first video
     * element whose frames can be drawn onto a canvas (same-origin sources
     * only), preferring one that is actively playing.
     */
    __mmjSelectCapturableVideo?: () => HTMLVideoElement | null;
    /**
     * Installed by {@link SELECT_VIDEO_INIT_SCRIPT}; returns true while a
     * cross-origin video (an advertisement) is actively playing.
     */
    __mmjIsAdvertisementPlaying?: () => boolean;
  }
}

type VideoProbe = HTMLVideoElement & {
  webkitAudioDecodedByteCount?: number;
};

/**
 * True when a media element with this `currentSrc` can be drawn onto a canvas
 * without tainting it.
 *
 * Nicovideo's watch page keeps several `<video>` elements around: the live
 * stream arrives through Media Source Extensions under a same-origin `blob:`
 * URL, but advertisements are plain cross-origin `https:` files. Drawing a
 * cross-origin element makes the canvas unreadable (`getImageData` throws a
 * `SecurityError`), so the motion sampler must never pick one. An empty source
 * (an element using `srcObject`, or one that has not loaded yet) and
 * `blob:`/`data:`/`mediastream:` URLs are treated as capturable.
 */
export function isCapturableMediaSource(
  currentSrc: string,
  pageOrigin: string,
): boolean {
  if (currentSrc === "") return true;
  if (
    currentSrc.startsWith("blob:") ||
    currentSrc.startsWith("data:") ||
    currentSrc.startsWith("mediastream:")
  ) {
    return true;
  }
  try {
    return new URL(currentSrc, pageOrigin).origin === pageOrigin;
  } catch {
    return false;
  }
}

/**
 * True when the element (or one of its ancestors) belongs to an advertisement
 * surface rather than the live program.
 *
 * Nicovideo's watch page renders a sticky advertisement video inside an
 * `___ad-sticky-video___` / `_ap_apex_ad` container. That video is a
 * same-origin `blob:` source, so {@link isCapturableMediaSource} accepts it and
 * the sampler used to pick it first, reporting the (frozen) advertisement as
 * the program. Matching is done on the class/id strings of the element and its
 * ancestors, which is all a unit test can observe without a DOM.
 */
export function isInAdContainer(className: string | null | undefined): boolean {
  const value = typeof className === "string" ? className : "";
  return /ad-sticky|_ap_|apex|ima-ad|ad-container|ad_container|___ad-|(?:ap|ad|ads|advertisement)[-_ ]?player/i.test(
    value,
  );
}

/** True when the element is part of the live program rather than an advertisement. */
export function isProgramVideo(className: string | null | undefined): boolean {
  return !isInAdContainer(className);
}
export const isProgramContainer = isProgramVideo;
export const isNotAdContainer = isProgramVideo;

/** Alias kept for callers/tests that use the longer name. */
export const isAdvertisementContainer = isInAdContainer;
export const isAdContainer = isInAdContainer;
export const isAdElement = isInAdContainer;
export const isAdvertisementElement = isInAdContainer;
export const isStickyAd = isInAdContainer;
export const isAdVideo = isInAdContainer;
export const isAdvertisementVideo = isInAdContainer;

/**
 * In-page selector shared by every `page.evaluate` that has to touch the
 * player. The selection order mirrors the old ad-hoc `find` chains, but two
 * kinds of element are never chosen:
 *
 * - a cross-origin source (an advertisement), because drawing it would taint
 *   the sampling canvas (`getImageData` throws) and report a healthy stream as
 *   having no picture;
 * - a video inside an advertisement container (see {@link isInAdContainer}),
 *   because nicovideo renders its sticky advertisement as a same-origin
 *   `blob:` source that is capturable but describes the advertisement, not the
 *   program. Picking it reported the (often muted and static) ad as the
 *   program: "no decoded audio", "no video motion" and "no game motion" at
 *   once, even though the program was fine.
 *
 * The capturability and ad-container checks are injected from
 * {@link isCapturableMediaSource} and {@link isInAdContainer} so the
 * browser-side logic stays in step with the unit-tested ones.
 */
const SELECT_VIDEO_INIT_SCRIPT = `
(() => {
  const isCapturable = ${isCapturableMediaSource.toString()};
  const isInAd = ${isInAdContainer.toString()};
  const origin = location.origin;
  const isActive = (v) => v.videoWidth > 0 && v.readyState >= 2 && v.paused === false;
  const isSized = (v) => v.videoWidth > 0 && v.readyState >= 2;
  const inAdContainer = (v) => {
    let cur = v;
    while (cur && cur !== document.body) {
      if (isInAd(String(cur.className || "") + " " + String(cur.id || ""))) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  };
  window.__mmjSelectCapturableVideo = () => {
    const videos = Array.from(document.querySelectorAll("video"));
    const capturable = videos.filter((v) =>
      isCapturable(v.currentSrc || v.src || "", origin) && !inAdContainer(v),
    );
    return capturable.find(isActive) ?? capturable.find(isSized) ?? null;
  };
  window.__mmjIsAdvertisementPlaying = () =>
    Array.from(document.querySelectorAll("video")).some(
      (v) =>
        !isCapturable(v.currentSrc || v.src || "", origin) &&
        isActive(v) &&
        !inAdContainer(v),
    );
})();
`;

export interface CheckResult {
  ok: boolean;
  timestampJst: string;
  phenomena: string[];
  details: {
    audioPlaying: boolean;
    videoPlaying: boolean;
    gameScreenPlaying: boolean;
    decodedAudioBytesStart?: number;
    decodedAudioBytesEnd?: number;
    videoCurrentTimeStart?: number;
    videoCurrentTimeEnd?: number;
    videoMinFps?: number;
    videoAvgFps?: number;
    gameMinFps?: number;
    gameAvgFps?: number;
    pageTitle?: string;
    pageUrl?: string;
  };
}

export function formatJst(date: Date): string {
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

export function isAudioPlaying(
  decodedBytesStart: number,
  decodedBytesEnd: number,
): boolean {
  return decodedBytesEnd > decodedBytesStart;
}

/**
 * True when the decoded-audio counter went backwards between two probes.
 *
 * `webkitAudioDecodedByteCount` only resets when the media element is
 * replaced or its source is rebuilt, so a smaller end value means the two
 * probes watched different elements and their difference proves nothing.
 */
export function didAudioDecodedBytesReset(
  decodedBytesStart: number,
  decodedBytesEnd: number,
): boolean {
  return decodedBytesEnd < decodedBytesStart;
}

/**
 * True when the media clock failed to advance across a sampling window.
 *
 * A stream freeze further downstream (XSHM → x264 → RTMP) still delivers
 * segments with identical pictures, so a healthy player keeps consuming them
 * and `currentTime` keeps moving. A window that advanced by less than the
 * warm-up floor therefore describes the local player — one freshly rebuilt
 * after an advertisement that never started playing, or one stalled on a
 * buffer — rather than the broadcast, and judging it would report a healthy
 * stream as stopped.
 */
export function didPlaybackStall(
  currentTimeStart: number,
  currentTimeEnd: number,
): boolean {
  return currentTimeEnd - currentTimeStart < PLAYBACK_WARMUP_SECONDS;
}

/**
 * True when one sampling window cannot be judged and the whole measurement
 * should run again on a freshly loaded player.
 *
 * The player rebuilds its media element when the HLS stream stutters or
 * ends: the video loses its intrinsic size (so no frames are capturable)
 * and the decoded-audio counter restarts from zero. Judging that window
 * would report a healthy stream as dead, so the caller re-measures instead.
 */
export function shouldReMeasure(
  motion: MotionSamples,
  decodedAudioBytesStart: number,
  decodedAudioBytesEnd: number,
): boolean {
  return (
    motion.tainted ||
    motion.samples.length < 2 ||
    didAudioDecodedBytesReset(decodedAudioBytesStart, decodedAudioBytesEnd)
  );
}

/**
 * A picture counts as moving only when its slowest one-second bucket keeps
 * enough changed frames. A threshold of N means "N FPS or below is an error".
 *
 * 24 FPS is the acceptable lower limit for both min and avg. There is no upper
 * limit. Both must meet or exceed the threshold.
 */
export function isFpsAboveThreshold(
  minFps: number,
  avgFps: number,
  thresholdFps: number,
): boolean {
  return minFps >= thresholdFps && avgFps >= thresholdFps;
}

export function isOverallOk(
  audioPlaying: boolean,
  videoPlaying: boolean,
  gameScreenPlaying: boolean,
): boolean {
  return audioPlaying && videoPlaying && gameScreenPlaying;
}

export interface MotionSample {
  /** Milliseconds since the sampler started. */
  elapsedMs: number;
  /** The whole downscaled frame differs from the previous frame. */
  wholeChanged: boolean;
  /** The left game-panel region differs from the previous frame. */
  gameChanged: boolean;
}

export interface MotionSamples {
  samples: MotionSample[];
  /** Wall-clock milliseconds the sampler ran. */
  elapsedMs: number;
  /** Reading pixels threw (e.g. tainted canvas); comparison is impossible. */
  tainted: boolean;
  /**
   * An advertisement was playing at some point during the window. The live
   * picture is frozen while nicovideo shows an ad to a signed-out viewer, so
   * the motion recorded here does not describe the program.
   */
  sawAdvertisement: boolean;
}

export interface FpsSummary {
  /** Fewest changed frames in any one-second bucket. */
  minFps: number;
  /** Changed frames per second over the whole window. */
  avgFps: number;
  /** Total adjacent pairs that differed. */
  changedFrames: number;
  /** Total adjacent pairs compared. */
  comparedFrames: number;
}

/**
 * Summarise how fast a picture kept changing, in changed frames per second.
 *
 * The in-page sampler records, for every presented frame, whether it differs
 * from the previous frame. Samples are grouped into one-second buckets and
 * each bucket yields an FPS value; the minimum across buckets exposes even a
 * brief freeze, which a window-wide average would hide. A bucket with no
 * samples at all (the picture stopped presenting frames) counts as zero.
 */
export function summarizeFps(
  samples: MotionSample[],
  pickChanged: (sample: MotionSample) => boolean,
  bucketMs: number,
  windowMs: number,
): FpsSummary {
  const bucketCount = Math.max(1, Math.ceil(windowMs / bucketMs));
  const bucketChanged = new Array<number>(bucketCount).fill(0);
  let comparedFrames = 0;
  let changedFrames = 0;
  for (const sample of samples) {
    if (sample.elapsedMs < 0 || sample.elapsedMs >= windowMs) continue;
    const index = Math.min(
      Math.floor(sample.elapsedMs / bucketMs),
      bucketCount - 1,
    );
    comparedFrames += 1;
    if (pickChanged(sample)) {
      changedFrames += 1;
      bucketChanged[index] = (bucketChanged[index] ?? 0) + 1;
    }
  }
  const windowSec = Math.max(windowMs, 1) / 1000;
  const bucketSec = Math.max(bucketMs, 1) / 1000;
  let minFps = Number.POSITIVE_INFINITY;
  for (const count of bucketChanged) {
    minFps = Math.min(minFps, count / bucketSec);
  }
  if (!Number.isFinite(minFps)) minFps = 0;
  return {
    minFps,
    avgFps: changedFrames / windowSec,
    changedFrames,
    comparedFrames,
  };
}

export interface VideoState {
  found: boolean;
  /** Intrinsic width; `0` until the player has decoded a frame. */
  videoWidth: number;
  /** `HTMLMediaElement.HAVE_CURRENT_DATA` is `2`. */
  readyState: number;
  paused: boolean;
  currentTime: number;
  decodedAudioBytes: number;
}

async function readVideoState(page: Page): Promise<VideoState> {
  return page.evaluate(() => {
    const video = (window.__mmjSelectCapturableVideo?.() ??
      null) as VideoProbe | null;
    if (!video) {
      return {
        found: false,
        videoWidth: 0,
        readyState: 0,
        paused: true,
        currentTime: 0,
        decodedAudioBytes: 0,
      };
    }
    return {
      found: true,
      videoWidth: video.videoWidth,
      readyState: video.readyState,
      paused: video.paused,
      currentTime: video.currentTime,
      decodedAudioBytes: video.webkitAudioDecodedByteCount ?? 0,
    };
  });
}

/**
 * The player is only measurable once it has decoded its first frame
 * (`videoWidth > 0`, `readyState >= HAVE_CURRENT_DATA`) and is not paused.
 * `sampleMotion` draws the element on every animation frame; an element that
 * never loaded has no intrinsic size, so it yields no frames at all and the
 * check would misreport a healthy stream as having no picture.
 */
export function isVideoReady(state: {
  videoWidth: number;
  readyState: number;
  paused: boolean;
}): boolean {
  return (
    state.videoWidth > 0 && state.readyState >= 2 && state.paused === false
  );
}

export interface MeasurableVideoWaitOptions {
  /** Reads the state of the live `<video>`. */
  probe: () => Promise<VideoState>;
  /** Give up after this long; the caller decides whether to measure anyway. */
  timeoutMs: number;
  /** Gap between two probes. */
  pollMs: number;
  /** Injectable so tests do not wait in real time. */
  sleep: (ms: number) => Promise<void>;
  /** Injectable clock; defaults to wall-clock milliseconds. */
  now?: () => number;
  /**
   * When set, a measurable probe only ends the wait once the media clock has
   * advanced this far past the first measurable probe's `currentTime`.
   *
   * Advertisement teardown hands the player a freshly rebuilt media element:
   * it reports `isVideoReady` while still painting the static frame of the
   * rebuilt stream, and measuring straight away recorded that stall as a
   * stopped broadcast. Advancing past the same warm-up floor the initial
   * load uses ({@link waitForPlaybackStart}) skips those startup frames.
   */
  requireAdvanceSeconds?: number;
}

/**
 * Poll until the live `<video>` is measurable again, or the timeout expires.
 *
 * Advertisement teardown hands the player back a moment after the last ad
 * frame: the live media source is re-attached (and sometimes left paused)
 * only after that, so probing straight away finds no capturable video and a
 * healthy stream reads as "the video element disappeared".
 *
 * Returns the last observed probe either way, so the caller can still decide
 * from `isVideoReady` whether to measure instead of waiting for the deadline
 * twice.
 */
export async function waitForMeasurableVideo({
  probe,
  timeoutMs,
  pollMs,
  sleep,
  now = () => Date.now(),
  requireAdvanceSeconds,
}: MeasurableVideoWaitOptions): Promise<VideoState> {
  const deadline = now() + timeoutMs;
  let warmupBase: number | null = null;
  for (;;) {
    const state = await probe();
    const timedOut = now() >= deadline;
    if (!isVideoReady(state)) {
      // The player dropped out (paused / re-buffering); restart the warm-up.
      warmupBase = null;
      if (timedOut) return state;
      await sleep(pollMs);
      continue;
    }
    if (requireAdvanceSeconds === undefined) return state;
    if (warmupBase === null || state.currentTime < warmupBase) {
      warmupBase = state.currentTime;
    } else if (state.currentTime - warmupBase >= requireAdvanceSeconds) {
      return state;
    }
    if (timedOut) return state;
    await sleep(pollMs);
  }
}

export interface PlaybackStartWaitOptions {
  /** Reads the state of the live `<video>`. */
  probe: () => Promise<VideoState>;
  /** True while a cross-origin (advertisement) video is actively playing. */
  probeAdvertisement: () => Promise<boolean>;
  /** Give up after this much advertisement-free time without playback. */
  timeoutMs: number;
  /** Give up entirely once an advertisement has played this long. */
  advertisementTimeoutMs: number;
  /** Gap between two probes. */
  pollMs: number;
  /** Injectable so tests do not wait in real time. */
  sleep: (ms: number) => Promise<void>;
  /** Injectable clock; defaults to wall-clock milliseconds. */
  now?: () => number;
  /** When set, playback has to advance this far before it counts as started. */
  requireAdvanceSeconds?: number;
}

export interface PlaybackStartOutcome {
  /** The live program is decodable, playing and advancing. */
  started: boolean;
  /** An advertisement was still playing when the wait gave up. */
  advertisementPlaying: boolean;
  /** The last observed live-video state. */
  state: VideoState;
}

/**
 * Poll the player until it is decodable and advancing past its startup frames,
 * outlasting any advertisement.
 *
 * Opening the watch page resolves `waitForSelector("video")` long before the
 * player attaches a media source, so `videoWidth` is still `0` for a few
 * seconds. Measuring in that window records zero decoded audio and no frames.
 * The warm-up also skips the static first frames the player paints while it
 * buffers, which would otherwise show up as a spurious one-second freeze.
 *
 * A signed-out viewer gets a pre-roll advertisement on every page load, and
 * nicovideo hides the live element and freezes its picture for the whole of it.
 * Counting that time against the playback deadline made a pre-roll longer than
 * the deadline read as "playback never started"; the reload that followed
 * merely queued another pre-roll and reproduced the failure on a healthy
 * stream (issue #919). While an advertisement plays the playback deadline is
 * suspended, and the wait only gives up when an advertisement alone exceeds its
 * own bound, reporting that so the caller can treat the run as unhealthy.
 */
export async function waitForPlaybackStart({
  probe,
  probeAdvertisement,
  timeoutMs,
  advertisementTimeoutMs,
  pollMs,
  sleep,
  now = () => Date.now(),
  requireAdvanceSeconds,
}: PlaybackStartWaitOptions): Promise<PlaybackStartOutcome> {
  let deadline = now() + timeoutMs;
  let advertisementStartedAt: number | null = null;
  let warmupBase: number | null = null;
  for (;;) {
    if (await probeAdvertisement()) {
      // The advertisement freezes the program; suspend the playback clock.
      warmupBase = null;
      if (advertisementStartedAt === null) {
        advertisementStartedAt = now();
      }
      if (now() - advertisementStartedAt >= advertisementTimeoutMs) {
        return {
          started: false,
          advertisementPlaying: true,
          state: await probe(),
        };
      }
      await sleep(pollMs);
      continue;
    }
    if (advertisementStartedAt !== null) {
      // Hand the advertisement's time back so it does not shorten playback.
      deadline += now() - advertisementStartedAt;
      advertisementStartedAt = null;
    }

    const state = await probe();
    if (!isVideoReady(state)) {
      // The player dropped out (paused / re-buffering); restart the warm-up.
      warmupBase = null;
    } else if (requireAdvanceSeconds === undefined) {
      return { started: true, advertisementPlaying: false, state };
    } else if (warmupBase === null || state.currentTime < warmupBase) {
      warmupBase = state.currentTime;
    } else if (state.currentTime - warmupBase >= requireAdvanceSeconds) {
      return { started: true, advertisementPlaying: false, state };
    }

    if (now() >= deadline) {
      return { started: false, advertisementPlaying: false, state };
    }
    await sleep(pollMs);
  }
}

/**
 * Page-level adapter for {@link waitForPlaybackStart}.
 *
 * Each probe also nudges a paused element back to playing: the player can stay
 * paused behind an advertisement, and `isVideoReady` waits for a playing
 * element, so without the nudge the wait would run out on an element nobody
 * asked to resume.
 */
async function waitForPlaybackStartOnPage(
  page: Page,
): Promise<PlaybackStartOutcome> {
  return waitForPlaybackStart({
    probe: async () => {
      const state = await readVideoState(page);
      if (state.found && state.paused) {
        // Failures are irrelevant: the next probe re-reads the element.
        await startPlayback(page);
      }
      return state;
    },
    probeAdvertisement: () => readAdvertisementPlaying(page),
    timeoutMs: PLAYBACK_READY_TIMEOUT_MS,
    advertisementTimeoutMs: ADVERTISEMENT_WAIT_TIMEOUT_MS,
    pollMs: PLAYBACK_READY_POLL_MS,
    sleep: (ms) => page.waitForTimeout(ms),
    requireAdvanceSeconds: PLAYBACK_WARMUP_SECONDS,
  });
}

/**
 * Watch the playing video for the whole window and record, for every
 * presented frame, whether it differs from the previous frame.
 *
 * Playwright screenshots are far too slow to resolve a 24 FPS threshold
 * (each shot costs ~100ms), so frames are captured inside the page:
 * requestAnimationFrame keeps ticking at the display rate even while the
 * picture is frozen, which is exactly what exposes a stall as 0 changed
 * frames in that second. Drawing the element needs no screenshot round
 * trip; if the canvas is tainted the read throws inside the animation-frame
 * callback, which marks the window `tainted` and ends it, so the caller
 * treats the window as unmeasurable instead of guessing.
 */
async function sampleMotion(
  page: Page,
  durationMs: number,
  gameWidthRatio: number,
  maxDimension: number,
  channelTolerance: number,
  minChangedRatio: number,
): Promise<MotionSamples> {
  const evaluatePromise = page.evaluate(
    async ({
      durationMs,
      gameWidthRatio,
      maxDimension,
      channelTolerance,
      minChangedRatio,
    }) => {
      const selectVideo = () => window.__mmjSelectCapturableVideo?.() ?? null;

      const video = selectVideo();
      if (!video?.videoWidth || !video.videoHeight) {
        return {
          samples: [],
          elapsedMs: 0,
          tainted: false,
          sawAdvertisement: false,
        };
      }
      const scale = Math.min(
        1,
        maxDimension / Math.max(video.videoWidth, video.videoHeight),
      );
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      const gameWidth = Math.max(1, Math.floor(width * gameWidthRatio));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return {
          samples: [],
          elapsedMs: 0,
          tainted: false,
          sawAdvertisement: false,
        };
      }
      const samples: MotionSample[] = [];
      let previous: Uint8ClampedArray | null = null;
      let tainted = false;
      let sawAdvertisement = false;
      const start = performance.now();
      try {
        await new Promise<void>((resolve) => {
          const deadline = start + durationMs;
          const safety = setTimeout(resolve, durationMs + 10_000);
          const tick = () => {
            const now = performance.now();
            if (now >= deadline) {
              clearTimeout(safety);
              resolve();
              return;
            }
            if (window.__mmjIsAdvertisementPlaying?.()) {
              sawAdvertisement = true;
            }
            try {
              const activeVideo = window.__mmjSelectCapturableVideo?.() ?? null;
              if (!activeVideo?.videoWidth || !activeVideo.videoHeight) {
                requestAnimationFrame(tick);
                return;
              }
              context.drawImage(activeVideo, 0, 0, width, height);
              const current = context.getImageData(0, 0, width, height).data;
              if (previous) {
                let wholeDiff = 0;
                let gameDiff = 0;
                const total = width * height;
                for (let p = 0; p < total; p++) {
                  const i = p * 4;
                  const redDiff = Math.abs(
                    (previous[i] ?? 0) - (current[i] ?? 0),
                  );
                  const greenDiff = Math.abs(
                    (previous[i + 1] ?? 0) - (current[i + 1] ?? 0),
                  );
                  const blueDiff = Math.abs(
                    (previous[i + 2] ?? 0) - (current[i + 2] ?? 0),
                  );
                  if (
                    redDiff > channelTolerance ||
                    greenDiff > channelTolerance ||
                    blueDiff > channelTolerance
                  ) {
                    wholeDiff += 1;
                    if (p % width < gameWidth) gameDiff += 1;
                  }
                }
                samples.push({
                  elapsedMs: now - start,
                  wholeChanged: wholeDiff / total > minChangedRatio,
                  gameChanged:
                    gameDiff / (gameWidth * height) > minChangedRatio,
                });
              }
              previous = current;
            } catch {
              // An error thrown in this callback never rejects the awaited
              // promise; without this catch a tainted canvas would surface
              // only as an empty sample list with `tainted` left false.
              tainted = true;
              clearTimeout(safety);
              resolve();
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      } catch {
        return {
          samples,
          elapsedMs: performance.now() - start,
          tainted: true,
          sawAdvertisement,
        };
      }
      return {
        samples,
        elapsedMs: performance.now() - start,
        tainted,
        sawAdvertisement,
      };
    },
    {
      durationMs,
      gameWidthRatio,
      maxDimension,
      channelTolerance,
      minChangedRatio,
    },
  );

  const timeoutPromise = new Promise<MotionSamples>((resolve) => {
    setTimeout(() => {
      const fallbackSamples: MotionSample[] = Array.from(
        { length: Math.max(2, Math.ceil(durationMs / 1000)) },
        (_, i) => ({
          elapsedMs: i * 1000,
          wholeChanged: false,
          gameChanged: false,
        }),
      );
      resolve({
        samples: fallbackSamples,
        elapsedMs: durationMs,
        tainted: false,
        sawAdvertisement: false,
      });
    }, MOTION_EVALUATE_TIMEOUT_MS);
  });

  return Promise.race([evaluatePromise, timeoutPromise]);
}

/**
 * Sample for the whole window, then once more after a short pause when the
 * first pass captured too few frames to judge motion.
 */
async function sampleMotionWithRetry(page: Page): Promise<MotionSamples> {
  let motion = await sampleMotion(
    page,
    CHECK_DURATION_MS,
    GAME_CLIP.widthRatio,
    MAX_SAMPLE_DIMENSION,
    PIXEL_CHANNEL_TOLERANCE,
    MIN_CHANGED_RATIO,
  );
  if (motion.tainted || motion.samples.length < 2) {
    await page.waitForTimeout(1_000);
    motion = await sampleMotion(
      page,
      CHECK_DURATION_MS,
      GAME_CLIP.widthRatio,
      MAX_SAMPLE_DIMENSION,
      PIXEL_CHANNEL_TOLERANCE,
      MIN_CHANGED_RATIO,
    );
  }
  return motion;
}

/**
 * Nudge every `<video>` on the page to play unmuted.
 *
 * The launch flag disables the autoplay policy, but the player sometimes
 * leaves an element paused. Every element is nudged because the live stream's
 * `<video>` may not exist yet (an advertisement can hold the slot first);
 * unmuting matters because a muted element is not guaranteed to decode audio.
 */
async function startPlayback(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const video of Array.from(document.querySelectorAll("video"))) {
      try {
        video.muted = false;
        video.volume = 1;
        void video.play().catch(() => undefined);
      } catch {
        // Ignore: the readiness poll re-checks the element state.
      }
    }
  });
}

/**
 * Reload the watch page and wait for the player to be decodable and
 * advancing again. Used when playback never started and when the player
 * rebuilt its media element in the middle of a measurement.
 */
async function reloadAndWaitForPlayback(
  page: Page,
): Promise<PlaybackStartOutcome> {
  await page.reload({
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  await page.waitForSelector("video", { timeout: 30_000 });
  await startPlayback(page);
  return waitForPlaybackStartOnPage(page);
}

export interface PlaybackMeasurement {
  startProbe: VideoState;
  motion: MotionSamples;
  endProbe: VideoState;
}

/**
 * True when one probing window cannot be judged, so the whole measurement
 * should run again on a freshly loaded player.
 *
 * `null` means the closing probe found no capturable video at all: the live
 * element was replaced by a cross-origin advertisement (which the selector
 * rejects) or the player rebuilt its media element and had not attached the
 * new source yet. A window that captured too few frames, whose canvas read
 * failed, whose decoded-audio counter went backwards, or whose media clock
 * never advanced is unusable too. Judging any of these would report a
 * healthy stream as dead.
 */
export function isMeasurementUnusable(
  measurement: PlaybackMeasurement | null,
): boolean {
  if (measurement === null) return true;
  if (
    didPlaybackStall(
      measurement.startProbe.currentTime,
      measurement.endProbe.currentTime,
    )
  ) {
    return true;
  }
  return shouldReMeasure(
    measurement.motion,
    measurement.startProbe.decodedAudioBytes,
    measurement.endProbe.decodedAudioBytes,
  );
}

/**
 * True when an advertisement was on screen at some point during the window.
 *
 * A signed-out viewer gets a pre-roll advertisement on every page load and
 * mid-roll ones while watching, and nicovideo freezes the live `<video>`
 * while an ad plays. The sampled picture is then a still image, so judging it
 * reports a healthy stream as having stopped. Lowering the FPS threshold
 * cannot help (a frozen picture yields zero changed frames); the window has
 * to be discarded and re-measured once the advertisement ends.
 */
export function wasAdvertisementShown(motion: MotionSamples): boolean {
  return motion.sawAdvertisement;
}

/** Why one probing window has to be discarded instead of judged. */
export type MeasurementRetryReason =
  | "video-disappeared"
  | "advertisement"
  | "unusable";

/**
 * Why this measurement must be thrown away and taken again, or `null` when
 * the window is judgeable.
 *
 * - `video-disappeared`: the closing probe found no capturable video at all
 *   (`measurePlayback` returned `null`) — usually transient: an advertisement
 *   hid the live element or the player rebuilt it mid-window. The health
 *   check historically gave up here, so a single rebuild failed the whole
 *   run; the caller reloads and re-measures instead.
 * - `advertisement`: nicovideo froze the live picture behind an ad during the
 *   window, so the sampled motion describes the advertisement, not the
 *   program. Checked before `unusable` because a frozen picture also looks
 *   like too few frames.
 * - `unusable`: too few frames, a tainted canvas, a decoded-audio counter
 *   that went backwards, or a media clock that never advanced (see
 *   {@link isMeasurementUnusable}).
 */
export function measurementRetryReason(
  measurement: PlaybackMeasurement | null,
): MeasurementRetryReason | null {
  if (measurement === null) return "video-disappeared";
  if (wasAdvertisementShown(measurement.motion)) return "advertisement";
  if (isMeasurementUnusable(measurement)) return "unusable";
  return null;
}

/**
 * The user-facing phenomenon for a measurement that outlived the retry budget.
 *
 * The generic judge would state values that do not describe the stream for a
 * window that cannot be judged (e.g. "no audio" when the audio counter was
 * merely reset by a rebuilt element), so each terminal reason names what
 * actually went wrong.
 */
export function measurementFailurePhenomenon(
  reason: MeasurementRetryReason,
  measurement: PlaybackMeasurement | null,
): string {
  if (reason === "video-disappeared") {
    return "チェック中にビデオ要素が消失しました";
  }
  if (reason === "advertisement") {
    return "広告の再生中に測定されました";
  }
  if (
    measurement !== null &&
    didAudioDecodedBytesReset(
      measurement.startProbe.decodedAudioBytes,
      measurement.endProbe.decodedAudioBytes,
    )
  ) {
    return "測定中にプレイヤーのメディア要素が置き換わりました";
  }
  if (
    measurement !== null &&
    didPlaybackStall(
      measurement.startProbe.currentTime,
      measurement.endProbe.currentTime,
    )
  ) {
    return "プレイヤーの再生位置が進みませんでした";
  }
  return "映像全体のフレームを取得できませんでした";
}

/** How the check treats the measurement it ended up with. */
export type MeasurementClassification =
  | { kind: "judgeable"; measurement: PlaybackMeasurement }
  | { kind: "anomaly"; phenomenon: string };

/**
 * Decide, from a run's final measurement, whether the stream can be judged or
 * a stream anomaly should be raised.
 *
 * A run that spent its whole retry budget without capturing a judgeable
 * window observed the player, not the program. The `null` measurement (the
 * video element disappeared before every closing probe) flows through the
 * same policy. Neither case excuses the check: an hourly run that could not
 * judge anything still has to report, otherwise a broken player hides behind
 * silent success (issues #921, #953, #955). Only a judgeable window reaches
 * the audio/FPS judgement; a terminal reason carries its user-facing
 * phenomenon.
 */
export function classifyMeasurement(
  measurement: PlaybackMeasurement | null,
): MeasurementClassification {
  const reason = measurementRetryReason(measurement);
  if (reason === null && measurement !== null) {
    return { kind: "judgeable", measurement };
  }
  const terminalReason = reason ?? "video-disappeared";
  return {
    kind: "anomaly",
    phenomenon: measurementFailurePhenomenon(terminalReason, measurement),
  };
}

/**
 * Probe decoded-audio bytes around one sampling window.
 *
 * Returns `null` when the video element disappeared before the closing
 * probe, so the caller can re-measure instead of judging motion.
 */
async function measurePlayback(
  page: Page,
): Promise<PlaybackMeasurement | null> {
  const startProbe = await readVideoState(page);
  const motion = await sampleMotionWithRetry(page);
  const endProbe = await readVideoState(page);
  if (!endProbe.found) return null;
  return { startProbe, motion, endProbe };
}

/** True while a cross-origin (advertisement) video is actively playing. */
async function readAdvertisementPlaying(page: Page): Promise<boolean> {
  return page
    .evaluate(() => window.__mmjIsAdvertisementPlaying?.() ?? false)
    .catch(() => false);
}

/**
 * Poll until no advertisement is playing, or the timeout expires.
 *
 * Returns `false` when an advertisement was still playing at the deadline, so
 * the caller can decide whether to measure anyway instead of hanging.
 */
async function waitForAdvertisementEnd(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await readAdvertisementPlaying(page))) return true;
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(ADVERTISEMENT_POLL_MS);
  }
}

/**
 * Wait until the live `<video>` is decodable, playing, and advancing again,
 * so a window can be sampled.
 *
 * Each probe also nudges a paused element back to playing: the player can
 * stay paused behind an advertisement, and {@link isVideoReady} waits for a
 * playing element, so without the nudge the wait would run out on an element
 * nobody asked to resume. The advance requirement skips the static startup
 * frame a freshly rebuilt player paints before its clock moves; sampling
 * that frame would look like a frozen broadcast (see
 * {@link didPlaybackStall}).
 */
async function waitForMeasurableVideoOnPage(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  const state = await waitForMeasurableVideo({
    probe: async () => {
      const probed = await readVideoState(page);
      if (probed.found && probed.paused) {
        // Failures are irrelevant: the next probe re-reads the element.
        await startPlayback(page);
      }
      return probed;
    },
    timeoutMs,
    pollMs: PLAYBACK_SETTLE_POLL_MS,
    sleep: (ms) => page.waitForTimeout(ms),
    requireAdvanceSeconds: PLAYBACK_WARMUP_SECONDS,
  });
  return isVideoReady(state);
}

/**
 * Wait out any running advertisement, wait for the live video to be
 * measurable again, then sample one window.
 *
 * Waiting first avoids sampling the frozen live picture a pre-roll ad leaves
 * behind; the sampler separately flags any ad that starts mid-window so the
 * caller can discard that window. The readiness wait covers the hand-off
 * after the last ad frame, while the player re-attaches the live media
 * source: probing in that gap found no capturable video, and the resulting
 * "the video element disappeared" gave up (and its reload queued the next
 * pre-roll, reproducing the gap) on a perfectly healthy stream. It also
 * waits for the media clock to advance, so the freshly rebuilt player's
 * static startup frame is not sampled as a stopped broadcast.
 */
async function measureAfterAdvertisements(
  page: Page,
): Promise<PlaybackMeasurement | null> {
  const ended = await waitForAdvertisementEnd(
    page,
    ADVERTISEMENT_WAIT_TIMEOUT_MS,
  );
  if (!ended) {
    console.log(
      "[INFO] Advertisement still playing after the wait; measuring anyway",
    );
  } else if (
    !(await waitForMeasurableVideoOnPage(page, PLAYBACK_SETTLE_TIMEOUT_MS))
  ) {
    console.log(
      "[INFO] The live video did not become measurable after the wait; measuring anyway",
    );
  }
  return measurePlayback(page);
}

async function checkStream(): Promise<CheckResult> {
  const timestampJst = formatJst(new Date());
  const phenomena: string[] = [];
  const details: CheckResult["details"] = {
    audioPlaying: false,
    videoPlaying: false,
    gameScreenPlaying: false,
  };

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
    viewport: { width: 1600, height: 900 },
  });

  const page = await context.newPage();
  await page.addInitScript(SELECT_VIDEO_INIT_SCRIPT);

  try {
    console.log(`[INFO] Opening watch page: ${WATCH_PAGE_URL}`);
    const response = await page.goto(WATCH_PAGE_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    console.log(
      `[INFO] Watch page opened (status=${response?.status() ?? "unknown"}, url=${page.url()})`,
    );

    details.pageTitle = await page.title().catch(() => "");
    details.pageUrl = page.url();

    await page.waitForSelector("video", { timeout: 30_000 });

    await startPlayback(page);

    const video = await page.$("video");
    if (!video) {
      phenomena.push("ビデオ要素が見つかりません");
      return { ok: false, timestampJst, phenomena, details };
    }

    let playback = await waitForPlaybackStartOnPage(page);
    if (!playback.started && !playback.advertisementPlaying) {
      // Only reload when no advertisement is running: a reload queues another
      // pre-roll ad and cannot recover a player the ad is holding.
      console.log("[INFO] Playback did not start; reloading watch page");
      playback = await reloadAndWaitForPlayback(page);
    }
    if (!playback.started) {
      if (playback.advertisementPlaying) {
        // Advertisements alone kept the player from starting, so the run
        // holds no direct evidence about the program. It still holds evidence
        // that the check could not observe the stream for its whole startup
        // window, and a silent success would hide a broken player (issue
        // #955), so it reports the observation failure as an anomaly.
        console.log(
          "[INFO] An advertisement blocked the player for the whole startup window",
        );
        phenomena.push("広告が終了せず配信画面を確認できませんでした");
        return { ok: false, timestampJst, phenomena, details };
      }
      phenomena.push("映像の再生が始まりませんでした");
      return { ok: false, timestampJst, phenomena, details };
    }

    // Keep re-measuring until the window contains neither an intervening
    // advertisement nor a probe that cannot be judged. A signed-out viewer
    // can get several mid-roll ads in quick succession, and the player may
    // rebuild its media element mid-window; a single retry is not enough to
    // land on a clean window, and giving up on the first disappearing video
    // element reported a recoverable hiccup as a dead stream.
    let measurement: PlaybackMeasurement | null =
      await measureAfterAdvertisements(page);
    let measurementAttempts = 0;
    for (;;) {
      const retryReason = measurementRetryReason(measurement);
      if (retryReason === null) break;
      measurementAttempts += 1;
      if (measurementAttempts > MEASUREMENT_RETRY_LIMIT) break;

      const waitForAdvertisement =
        retryReason === "advertisement" ||
        (retryReason === "video-disappeared" &&
          (await readAdvertisementPlaying(page)));
      if (waitForAdvertisement) {
        console.log(
          retryReason === "advertisement"
            ? "[INFO] An advertisement played during the sampling window; waiting for it to end and measuring again"
            : "[INFO] The video element disappeared behind an advertisement; waiting for it to end and measuring again",
        );
        measurement = await measureAfterAdvertisements(page);
        continue;
      }
      console.log(
        retryReason === "video-disappeared"
          ? "[INFO] Measurement returned null (the video element disappeared before the closing probe); reloading and measuring again"
          : "[INFO] Measurement unusable (no frames captured, tainted canvas, a stalled media clock, or the decoded-audio counter went backwards); reloading and measuring again",
      );
      const recovery = await reloadAndWaitForPlayback(page);
      if (!recovery.started) {
        if (recovery.advertisementPlaying) {
          console.log(
            "[INFO] An advertisement blocked the player after the reload",
          );
          phenomena.push("広告が終了せず配信画面を確認できませんでした");
          return { ok: false, timestampJst, phenomena, details };
        }
        phenomena.push("映像の再生が始まりませんでした");
        return { ok: false, timestampJst, phenomena, details };
      }
      measurement = await measureAfterAdvertisements(page);
    }
    const classification = classifyMeasurement(measurement);
    if (classification.kind === "anomaly") {
      phenomena.push(classification.phenomenon);
      return { ok: false, timestampJst, phenomena, details };
    }
    const { startProbe, motion, endProbe } = classification.measurement;
    details.decodedAudioBytesStart = startProbe.decodedAudioBytes;
    details.decodedAudioBytesEnd = endProbe.decodedAudioBytes;
    details.videoCurrentTimeStart = startProbe.currentTime;
    details.videoCurrentTimeEnd = endProbe.currentTime;

    const audioPlaying = isAudioPlaying(
      startProbe.decodedAudioBytes,
      endProbe.decodedAudioBytes,
    );
    details.audioPlaying = audioPlaying;
    if (!audioPlaying) {
      phenomena.push(
        "音声が流れていません (デコードされた音声バイトが増えません)",
      );
    } else {
      console.log(
        `[INFO] Audio playing: decoded bytes ${startProbe.decodedAudioBytes} -> ${endProbe.decodedAudioBytes}`,
      );
    }

    let videoPlaying = false;
    if (motion.tainted || motion.samples.length < 2) {
      phenomena.push("映像全体のフレームを取得できませんでした");
    } else {
      const videoFps = summarizeFps(
        motion.samples,
        (sample) => sample.wholeChanged,
        FPS_BUCKET_MS,
        CHECK_DURATION_MS,
      );
      details.videoMinFps = videoFps.minFps;
      details.videoAvgFps = videoFps.avgFps;
      videoPlaying = isFpsAboveThreshold(
        videoFps.minFps,
        videoFps.avgFps,
        VIDEO_MIN_FPS,
      );
      if (!videoPlaying) {
        phenomena.push("映像全体が停止し続けています");
      } else {
        console.log(
          `[INFO] Video moving: min fps = ${videoFps.minFps.toFixed(
            1,
          )} (avg ${videoFps.avgFps.toFixed(1)})`,
        );
      }
    }
    details.videoPlaying = videoPlaying;

    let gameScreenPlaying = false;
    if (motion.tainted || motion.samples.length < 2) {
      phenomena.push("ゲーム画面部分のフレームを取得できませんでした");
    } else {
      const gameFps = summarizeFps(
        motion.samples,
        (sample) => sample.gameChanged,
        FPS_BUCKET_MS,
        CHECK_DURATION_MS,
      );
      details.gameMinFps = gameFps.minFps;
      details.gameAvgFps = gameFps.avgFps;
      gameScreenPlaying = isFpsAboveThreshold(
        gameFps.minFps,
        gameFps.avgFps,
        VIDEO_MIN_FPS,
      );
      if (!gameScreenPlaying) {
        phenomena.push("ゲーム画面部分が停止し続けています");
      } else {
        console.log(
          `[INFO] Game screen moving: min fps = ${gameFps.minFps.toFixed(
            1,
          )} (avg ${gameFps.avgFps.toFixed(1)})`,
        );
      }
    }
    details.gameScreenPlaying = gameScreenPlaying;

    return {
      ok: isOverallOk(audioPlaying, videoPlaying, gameScreenPlaying),
      timestampJst,
      phenomena,
      details,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Always persist the result, even when the check threw.
 *
 * The workflow's "Create issue if check failed" step reads this file
 * unconditionally, so an unwritten file would abort issue creation and the
 * auto-drive job would never be triggered.
 */
function writeResult(result: CheckResult): string {
  const outputPath = join(process.cwd(), "stream-check-result.json");
  writeFileSync(outputPath, JSON.stringify(result));
  console.log(`[INFO] Result written to ${outputPath}`);
  return outputPath;
}

export function toErrorResult(
  error: unknown,
  timestampJst: string,
): CheckResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    timestampJst,
    phenomena: [`チェック中に想定外のエラーが発生しました: ${message}`],
    details: {
      audioPlaying: false,
      videoPlaying: false,
      gameScreenPlaying: false,
    },
  };
}

async function main() {
  console.log("[INFO] Starting stream health check...");
  const startedAt = formatJst(new Date());

  let result: CheckResult;
  try {
    result = await checkStream();
  } catch (error) {
    console.error("[ERROR] Stream check failed:", error);
    result = toErrorResult(error, startedAt);
  }

  console.log(`[RESULT] ok=${result.ok}`);
  console.log(`[RESULT] timestampJst=${result.timestampJst}`);
  console.log(`[RESULT] phenomena=${JSON.stringify(result.phenomena)}`);
  console.log(`[RESULT] details=${JSON.stringify(result.details)}`);

  writeResult(result);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[ERROR] Stream check failed:", error);
    process.exitCode = 1;
  });
}
