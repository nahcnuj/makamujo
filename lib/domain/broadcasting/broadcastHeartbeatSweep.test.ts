import { describe, expect, it } from "bun:test";
import {
  type HeartbeatSweep,
  minVisibleBandHeightVh,
  sweepsWithoutLeavingViewport,
} from "./broadcastHeartbeatSweep";

function sweep(
  bandHeightVh: number,
  fromYvh: number,
  toYvh: number,
): HeartbeatSweep {
  return { bandHeightVh, fromYvh, toYvh };
}

describe("minVisibleBandHeightVh", () => {
  it("returns the full band height when the sweep stays inside the viewport", () => {
    expect(minVisibleBandHeightVh(sweep(6, 0, 92))).toBe(6);
  });

  it("deducts the part hanging above the viewport at the start", () => {
    expect(minVisibleBandHeightVh(sweep(6, -4, 92))).toBe(2);
  });

  it("deducts the part hanging below the viewport at the end", () => {
    expect(minVisibleBandHeightVh(sweep(6, -2, 97))).toBe(3);
  });

  it("goes to 0 when the band fully leaves the viewport", () => {
    // 2026-10-22 時点の実装: -12vh から 112vh を 6vh の帯で掃引しており、
    // 両端で帯が完全に画面外になる（issue #1001）。
    expect(minVisibleBandHeightVh(sweep(6, -12, 112))).toBe(0);
  });
});

describe("sweepsWithoutLeavingViewport", () => {
  it("accepts a sweep that keeps the band on screen", () => {
    expect(sweepsWithoutLeavingViewport(sweep(6, -2, 92))).toBe(true);
  });

  it("rejects the sweep that leaves the band off screen", () => {
    expect(sweepsWithoutLeavingViewport(sweep(6, -12, 112))).toBe(false);
  });
});
