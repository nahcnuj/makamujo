import { useInterval } from "../hooks/useInterval";

/**
 * The path the overlay page reports itself to.
 *
 * The page is loaded by the OBS browser source, and the browser source is the
 * overlay of the delivered picture. When its renderer dies, the overlay
 * disappears from the picture and the heartbeat band with it, so the picture
 * stands still whenever the game stands still. The server watches these
 * beacons and restarts OBS when they stop
 * (`composition/overlayLivenessMonitor.ts`).
 */
export const OVERLAY_BEACON_PATH = "/api/overlay-beacon";

/**
 * How often the page reports itself.
 *
 * The server treats a minute of silence as a dead overlay, so the interval
 * only has to be short enough to notice the death within that minute.
 */
export const OVERLAY_BEACON_INTERVAL_MS = 5_000;

/**
 * Report the liveness of the overlay page to the broadcasting server.
 *
 * The beacon is a plain request to the server that serves this page, so it
 * fails exactly when the page is not running any more: a crashed renderer
 * stops the timer, and a page that never loaded never sends one. A failing
 * request is swallowed here — the server is the one that decides what a
 * missing beacon means.
 */
export function OverlayBeacon() {
  useInterval(OVERLAY_BEACON_INTERVAL_MS, async () => {
    await fetch(OVERLAY_BEACON_PATH).catch(() => undefined);
  });
  return null;
}
