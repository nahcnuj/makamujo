import { describe, expect, it } from "bun:test";
import { OVERLAY_BEACON_PATH, OverlayBeacon } from "./OverlayBeacon";

describe("OverlayBeacon", () => {
  it("reports itself to the broadcasting server", () => {
    // The path is the contract with the server: the monitor restarts OBS when
    // the reports stop, so the page has to use exactly this path.
    expect(OVERLAY_BEACON_PATH).toBe("/api/overlay-beacon");
  });

  it("renders nothing into the picture", () => {
    // The beacon is not a visual element: it must not change the picture the
    // check measures.
    expect(OverlayBeacon()).toBeNull();
  });
});
