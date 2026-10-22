/**
 * Geometry contract for the heartbeat band that keeps the delivered picture moving.
 *
 * The scheduled health checker reads the stream from the outside and calls the
 * picture stopped when it does not change for a whole second (`videoMinFps` /
 * `gameMinFps`; `scripts/check-stream.ts` is the owner contract #807 and is
 * never modified). It compares frames downscaled to at most 128px wide, so the
 * smallest motion it can see is one row of that downscaled picture. The
 * overlay therefore has to move a band by at least one such row per delivered
 * frame: the band is the only thing that moves while the game sits on a
 * result screen or during free talk, and without it the composite output
 * really is identical frame after frame (2026-10-22 12:30:56 JST:
 * `videoMinFps = 0` / `gameMinFps = 0` while the audio and the media clock
 * advanced).
 *
 * The numbers live here as a pure contract so the shipped markup and style can
 * be checked against them (`src/broadcastHeartbeat.test.ts`) and reasoned
 * about without a browser.
 */

/** Width in pixels the checker downsamples the picture to before comparing. */
export const BROADCAST_HEARTBEAT_SAMPLE_MAX_WIDTH_PX = 128;

/** Frames per second the OBS browser source delivers the overlay at. */
export const BROADCAST_HEARTBEAT_DELIVERY_FPS = 30;

/**
 * The smallest motion the checker can see, in rows of the downscaled picture.
 *
 * One row per delivered frame is the margin rule: the band has to cross a row
 * boundary on every frame, otherwise a frame pair can be identical after
 * downscaling (and after H.264 has smoothed the difference away).
 */
export const BROADCAST_HEARTBEAT_MINIMUM_SAMPLE_ROWS_PER_FRAME = 1;

export interface BroadcastHeartbeatGeometry {
  /** Width of the delivered picture in pixels (the browser source is 1280). */
  pictureWidthPx: number;
  /** Height of the delivered picture in pixels (the browser source is 720). */
  pictureHeightPx: number;
  /** Band height as a share of the picture height (vh). */
  bandHeightVh: number;
  /** Distance the band travels down the picture (vh). */
  travelVh: number;
  /** Seconds one full sweep takes. */
  sweepSeconds: number;
  /** Frames per second the picture is delivered at. */
  deliveryFps: number;
}

/**
 * The geometry the overlay ships with.
 *
 * The sweep is one second long: the band crosses the picture in 92vh, so it
 * moves about 22.1 picture pixels per frame at 30fps, which is 2.21 rows of
 * the downscaled picture — twice the one row the checker needs to see. The
 * former 2.4s sweep moved 0.94 rows per frame, which left the detection to
 * the rounding of the downscaling and to the compression of the encoder.
 */
export const BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY: BroadcastHeartbeatGeometry =
  {
    pictureWidthPx: 1280,
    pictureHeightPx: 720,
    bandHeightVh: 8,
    travelVh: 92,
    sweepSeconds: 1,
    deliveryFps: BROADCAST_HEARTBEAT_DELIVERY_FPS,
  };

/**
 * The factor the checker shrinks the picture by before comparing frames.
 *
 * The checker keeps the longest side at 128px, so a 16:9 picture becomes
 * 128x72 and every row of the compared picture is one pixel tall.
 */
export const heartbeatSampleScale = (
  geometry: BroadcastHeartbeatGeometry,
): number =>
  Math.min(
    1,
    BROADCAST_HEARTBEAT_SAMPLE_MAX_WIDTH_PX / geometry.pictureWidthPx,
  );

/** Rows of the downscaled picture the checker compares. */
export const heartbeatSampleRows = (
  geometry: BroadcastHeartbeatGeometry,
): number =>
  Math.max(
    1,
    Math.round(geometry.pictureHeightPx * heartbeatSampleScale(geometry)),
  );

/** How far the band travels between two delivered frames, in picture pixels. */
export const heartbeatMovementPxPerFrame = (
  geometry: BroadcastHeartbeatGeometry,
): number =>
  ((geometry.travelVh / 100) * geometry.pictureHeightPx) /
  (geometry.sweepSeconds * geometry.deliveryFps);

/**
 * How far the band travels between two delivered frames, in rows of the
 * downscaled picture — the unit the checker can actually see.
 */
export const heartbeatSampleRowsPerFrame = (
  geometry: BroadcastHeartbeatGeometry,
): number =>
  heartbeatMovementPxPerFrame(geometry) * heartbeatSampleScale(geometry);

/**
 * True while the band stays inside the picture.
 *
 * A band that leaves the picture completely stops changing the picture for
 * the frames it is gone, and the one-second bucket of the checker then holds
 * no changed frame at all — the band would create the very freeze it exists
 * to prevent.
 */
export const heartbeatStaysOnScreen = (
  geometry: BroadcastHeartbeatGeometry,
): boolean => geometry.travelVh + geometry.bandHeightVh <= 100;

export interface BroadcastHeartbeatEvaluation {
  /** The band never leaves the picture. */
  staysOnScreen: boolean;
  /** Rows of the downscaled picture the band moves per delivered frame. */
  sampleRowsPerFrame: number;
  /** The band moves fast enough for the checker to see it. */
  detectable: boolean;
}

/**
 * Judge a geometry against the contract.
 *
 * `detectable` means the band keeps the picture changing for the checker:
 * it stays on screen and it moves at least one row of the downscaled picture
 * per delivered frame.
 */
export const evaluateBroadcastHeartbeat = (
  geometry: BroadcastHeartbeatGeometry,
): BroadcastHeartbeatEvaluation => {
  const staysOnScreen = heartbeatStaysOnScreen(geometry);
  const sampleRowsPerFrame = heartbeatSampleRowsPerFrame(geometry);
  return {
    staysOnScreen,
    sampleRowsPerFrame,
    detectable:
      staysOnScreen &&
      sampleRowsPerFrame >= BROADCAST_HEARTBEAT_MINIMUM_SAMPLE_ROWS_PER_FRAME,
  };
};
