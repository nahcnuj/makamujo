/**
 * VRT (Visual Regression Test) mode freezes non-deterministic / animated
 * elements of the broadcast overlay so captured frames are reproducible.
 *
 * Activated by the `?vrt=1` query parameter on the page URL (used by the
 * RTMPS VRT capture) or by a `vrt-mode` meta tag injected by the server
 * (`VRT_MODE=1`).
 */
export const isVrtMode = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("vrt") === "1") {
      return true;
    }
  } catch {
    // ignore
  }
  try {
    const meta = document.querySelector('meta[name="vrt-mode"]');
    return meta?.getAttribute("content") === "1";
  } catch {
    return false;
  }
};
