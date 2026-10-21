/**
 * The heartbeat band that keeps the delivered picture moving.
 *
 * The scheduled health checker (`scripts/check-stream.ts` — the authority for
 * *detecting* anomalies, never modified) downsizes the delivered frame to
 * 128x72, counts a frame as "moved" when more than 0.1% of its pixels changed
 * by more than 16 per channel, and groups the samples into one-second
 * buckets. The whole picture has to move in at least 24 frames per bucket
 * (`VIDEO_MIN_FPS`) and the left 60% (the game panel) in at least 8
 * (`GAME_MIN_FPS`).
 *
 * The band is the only motion the overlay can guarantee. While the game sits
 * on a result screen and no comment arrives, everything else on the page is
 * still, and the composite output really does deliver the very same frame
 * over and over (2026-10-21 22:27 through 2026-10-22 04:23: the audio and the
 * media clock advanced while `videoMinFps` / `gameMinFps` stayed at 0).
 *
 * Two properties decide whether the band keeps the picture above the
 * detector's thresholds, and both are cheap to check as pure functions:
 *
 * - the band has to stay inside the viewport for the whole sweep. A band that
 *   leaves the screen freezes the picture for the frames it spends outside,
 *   and the one-second bucket that contains them drops below 24 moved frames
 *   (measured: `videoMinFps` 16 with a -12vh → 112vh sweep, 30 with a
 *   0vh → 94vh sweep);
 * - the band has to move faster than one sample row per frame, otherwise the
 *   downsized picture can repeat itself from frame to frame.
 *
 * The stylesheet is the single source of truth: the band is parsed straight
 * out of `src/index.css`, so changing the CSS changes what these functions
 * judge. `tests/integration/broadcast-heartbeat-band.test.ts` checks the same
 * band in a real browser with the detector's own arithmetic.
 */

/** The detector's downsized frame width (px) — `MAX_SAMPLE_DIMENSION` in `scripts/check-stream.ts`. */
export const DETECTOR_SAMPLE_WIDTH = 128;

/** The detector's downsized frame height (px) for the 16:9 picture OBS delivers. */
export const DETECTOR_SAMPLE_HEIGHT = 72;

/** Frames per second the OBS browser source delivers. */
export const BROWSER_SOURCE_FPS = 30;

/** The band as the stylesheet describes it. */
export interface HeartbeatBandSpec {
  /** Height of the band (vh). */
  bandHeightVh: number;
  /** Top edge of the band at the start of a sweep (vh). */
  fromVh: number;
  /** Top edge of the band at the end of a sweep (vh). */
  toVh: number;
  /** Duration of one sweep leg (ms). */
  legDurationMs: number;
  /** Whether the sweep reverses instead of restarting. It never pauses. */
  alternate: boolean;
  /** The fully opaque colour of the band, if the stylesheet has one. */
  coreColor: string | undefined;
}

const KEYFRAMES_PATTERN =
  /@keyframes\s+broadcast-heartbeat-sweep\s*\{([\s\S]*?)\n\}/;
const BAND_RULE_PATTERN = /\.broadcast-heartbeat\s*\{([\s\S]*?)\n\}/;
const OPAQUE_COLOR_PATTERN =
  /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*1\s*\)/;

/**
 * Read the band out of the stylesheet.
 *
 * Throws when the stylesheet no longer describes a band the detector can
 * rely on: a stylesheet the checker cannot read is a band nobody verifies.
 */
export const parseHeartbeatBandSpec = (css: string): HeartbeatBandSpec => {
  const keyframes = css.match(KEYFRAMES_PATTERN)?.[1];
  if (keyframes === undefined) {
    throw new Error("broadcast-heartbeat-sweep keyframes not found");
  }
  const from = keyframes.match(
    /from\s*\{[^}]*translateY\(\s*(-?[\d.]+)vh\s*\)/,
  )?.[1];
  const to = keyframes.match(
    /to\s*\{[^}]*translateY\(\s*(-?[\d.]+)vh\s*\)/,
  )?.[1];
  if (from === undefined || to === undefined) {
    throw new Error("broadcast-heartbeat-sweep translateY not found");
  }

  const rule = css.match(BAND_RULE_PATTERN)?.[1];
  if (rule === undefined) {
    throw new Error(".broadcast-heartbeat rule not found");
  }
  const height = rule.match(/height:\s*([\d.]+)vh/)?.[1];
  if (height === undefined) {
    throw new Error(".broadcast-heartbeat height not found");
  }
  const animation = rule.match(
    /animation:\s*([\w-]+)\s+([\d.]+)s\s+([\w-]+)\s+([\w-]+)(?:\s+([\w-]+))?/,
  );
  if (!animation) {
    throw new Error(".broadcast-heartbeat animation not found");
  }
  const [, name, duration, timing, iteration, direction] = animation;
  if (name !== "broadcast-heartbeat-sweep") {
    throw new Error(`unexpected band animation: ${name ?? "none"}`);
  }
  if (timing !== "linear") {
    throw new Error(`the band must sweep linearly: ${timing ?? "none"}`);
  }
  if (iteration !== "infinite") {
    throw new Error(`the band must keep sweeping: ${iteration ?? "none"}`);
  }
  if (direction !== undefined && direction !== "alternate") {
    throw new Error(`unexpected band animation direction: ${direction}`);
  }

  return {
    bandHeightVh: Number(height),
    fromVh: Number(from),
    toVh: Number(to),
    legDurationMs: Number(duration) * 1000,
    alternate: direction === "alternate",
    coreColor: rule.match(OPAQUE_COLOR_PATTERN)?.[0],
  };
};

/**
 * The smallest height of the band that stays visible during the sweep (vh).
 *
 * Zero when the band leaves the viewport: the frames it spends outside are
 * frames the delivered picture does not move at all.
 */
export const minVisibleBandHeightVh = (spec: HeartbeatBandSpec): number => {
  const lowest = Math.min(spec.fromVh, spec.toVh);
  const highest = Math.max(spec.fromVh, spec.toVh);
  // The band is completely outside the viewport while its top edge is at or
  // above the bottom of the screen, or at or below `-height` from the top.
  if (highest >= 100 || lowest + spec.bandHeightVh <= 0) {
    return 0;
  }
  const visibleAt = (top: number): number =>
    Math.max(0, Math.min(top + spec.bandHeightVh, 100) - Math.max(top, 0));
  // The visible height is concave in the top edge, so the sweep's ends hold
  // the minimum.
  return Math.min(visibleAt(lowest), visibleAt(highest));
};

/** Distance the band travels in one frame (px). */
export const movementPxPerFrame = (
  spec: HeartbeatBandSpec,
  viewportHeightPx: number,
  fps: number,
): number => {
  const travelVh = Math.abs(spec.toVh - spec.fromVh);
  const legSeconds = spec.legDurationMs / 1000;
  return ((travelVh / 100) * viewportHeightPx) / legSeconds / fps;
};

/** Height of one row of the detector's downsized frame (px). */
export const sampleRowHeightPx = (viewportHeightPx: number): number =>
  viewportHeightPx / DETECTOR_SAMPLE_HEIGHT;

/**
 * Whether the band alone keeps the delivered picture moving.
 *
 * The band has to stay visible for the whole sweep and move faster than one
 * sample row per frame; slower than that and the downsized picture can repeat
 * itself from frame to frame, which the detector reads as a stopped stream.
 */
export const bandKeepsPictureMoving = (
  spec: HeartbeatBandSpec,
  viewportHeightPx: number,
  fps: number = BROWSER_SOURCE_FPS,
): boolean =>
  minVisibleBandHeightVh(spec) > 0 &&
  movementPxPerFrame(spec, viewportHeightPx, fps) >
    sampleRowHeightPx(viewportHeightPx);
