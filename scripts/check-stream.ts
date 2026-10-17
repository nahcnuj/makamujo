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
  return /ad-sticky|_ap_|apex|ima-ad|ad-container|ad_container|___ad-/i.test(
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
    Array.from(document.querySelectorAll("video")).some((v) => {
      // A same-origin blob: advertisement (nicovideo's sticky ad) is
      // capturable but lives inside an advertisement container, so the
      // container check catches it even though the source check does not.
      const inAd = inAdContainer(v);
      const capturable = isCapturable(v.currentSrc || v.src || "", origin);
      return (inAd || !capturable) && isActive(v);
    });
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
 */
export function isFpsAboveThreshold(
  minFps: number,
  thresholdFps: number,
): boolean {
  return minFps > thresholdFps;
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

/**
 * Poll the player until it is decodable and advancing past its startup frames.
 *
 * Opening the watch page resolves `waitForSelector("video")` long before the
 * player attaches a media source, so `videoWidth` is still `0` for a few
 * seconds. Measuring in that window records zero decoded audio and no frames.
 * The warm-up also skips the static first frames the player paints while it
 * buffers, which would otherwise show up as a spurious one-second freeze.
 */
async function waitForVideoPlayback(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let warmupBase: number | null = null;
  for (;;) {
    const state = await readVideoState(page);
    if (isVideoReady(state)) {
      if (warmupBase === null) {
        warmupBase = state.currentTime;
      } else if (state.currentTime - warmupBase >= PLAYBACK_WARMUP_SECONDS) {
        return true;
      }
    } else {
      // The player dropped out (paused / re-buffering); restart the warm-up.
      warmupBase = null;
    }
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(PLAYBACK_READY_POLL_MS);
  }
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
  return page.evaluate(
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
          const safety = setTimeout(resolve, durationMs + 2_000);
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
async function reloadAndWaitForPlayback(page: Page): Promise<boolean> {
  await page.reload({
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  await page.waitForSelector("video", { timeout: 30_000 });
  await startPlayback(page);
  return waitForVideoPlayback(page, PLAYBACK_READY_TIMEOUT_MS);
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
 * failed, or whose decoded-audio counter went backwards is unusable too.
 * Judging any of these would report a healthy stream as dead.
 */
export function isMeasurementUnusable(
  measurement: PlaybackMeasurement | null,
): boolean {
  if (measurement === null) return true;
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
 * Wait out any running advertisement, then sample one window.
 *
 * Waiting first avoids sampling the frozen live picture a pre-roll ad leaves
 * behind; the sampler separately flags any ad that starts mid-window so the
 * caller can discard that window.
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

    let playbackStarted = await waitForVideoPlayback(
      page,
      PLAYBACK_READY_TIMEOUT_MS,
    );
    if (!playbackStarted) {
      console.log("[INFO] Playback did not start; reloading watch page");
      playbackStarted = await reloadAndWaitForPlayback(page);
    }
    if (!playbackStarted) {
      phenomena.push("映像の再生が始まりませんでした");
      return { ok: false, timestampJst, phenomena, details };
    }

    // Keep re-measuring until the window contains neither an intervening
    // advertisement nor an unusable (rebuilt media element) probe. A signed-out
    // viewer can get several mid-roll ads in quick succession, and a single
    // retry is not enough to land on a clean window.
    let measurement: PlaybackMeasurement | null =
      await measureAfterAdvertisements(page);
    let measurementAttempts = 0;
    while (
      measurement !== null &&
      (wasAdvertisementShown(measurement.motion) ||
        isMeasurementUnusable(measurement))
    ) {
      measurementAttempts += 1;
      if (measurementAttempts > 5) {
        break;
      }
      if (wasAdvertisementShown(measurement.motion)) {
        console.log(
          "[INFO] An advertisement played during the sampling window; waiting for it to end and measuring again",
        );
        measurement = await measureAfterAdvertisements(page);
        continue;
      }
      console.log(
        "[INFO] Measurement unusable (no video, no frames captured, or the decoded-audio counter went backwards); reloading and measuring again",
      );
      const recovered = await reloadAndWaitForPlayback(page);
      if (!recovered) {
        phenomena.push("映像の再生が始まりませんでした");
        return { ok: false, timestampJst, phenomena, details };
      }
      measurement = await measureAfterAdvertisements(page);
    }
    if (!measurement) {
      phenomena.push("チェック中にビデオ要素が消失しました");
      return { ok: false, timestampJst, phenomena, details };
    }
    const { startProbe, motion, endProbe } = measurement;
    details.decodedAudioBytesStart = startProbe.decodedAudioBytes;
    details.decodedAudioBytesEnd = endProbe.decodedAudioBytes;

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
      videoPlaying = isFpsAboveThreshold(videoFps.minFps, VIDEO_MIN_FPS);
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
      gameScreenPlaying = isFpsAboveThreshold(gameFps.minFps, GAME_MIN_FPS);
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
