import { describe, expect, it } from "bun:test";
import type { BroadcastHeartbeatGeometry } from "./broadcastHeartbeat";
import {
  BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY,
  BROADCAST_HEARTBEAT_MINIMUM_SAMPLE_ROWS_PER_FRAME,
  evaluateBroadcastHeartbeat,
  heartbeatMovementPxPerFrame,
  heartbeatSampleRows,
  heartbeatSampleRowsPerFrame,
  heartbeatSampleScale,
  heartbeatStaysOnScreen,
} from "./broadcastHeartbeat";

const geometry = (
  overrides: Partial<BroadcastHeartbeatGeometry> = {},
): BroadcastHeartbeatGeometry => ({
  ...BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY,
  ...overrides,
});

describe("broadcastHeartbeat", () => {
  it("shrinks the picture the way the checker does", () => {
    expect(heartbeatSampleScale(geometry())).toBe(0.1);
    expect(heartbeatSampleRows(geometry())).toBe(72);
  });

  it("keeps the band inside the picture", () => {
    expect(heartbeatStaysOnScreen(geometry())).toBe(true);
  });

  it("moves the band by more than one sample row per delivered frame", () => {
    const evaluation = evaluateBroadcastHeartbeat(geometry());
    expect(evaluation.detectable).toBe(true);
    expect(evaluation.sampleRowsPerFrame).toBeGreaterThan(
      BROADCAST_HEARTBEAT_MINIMUM_SAMPLE_ROWS_PER_FRAME,
    );
    // 92vh per second at 30fps is 22.08 picture pixels per frame, which is
    // 2.21 rows of the 128x72 picture the checker compares.
    expect(heartbeatMovementPxPerFrame(geometry())).toBeCloseTo(22.08, 5);
    expect(heartbeatSampleRowsPerFrame(geometry())).toBeCloseTo(2.208, 5);
  });

  it("does not accept the former 2.4s sweep", () => {
    // 0.94 rows per frame: the band crossed a row boundary only on most
    // frames, so the detection was left to the rounding of the downscaling
    // and to the encoder (2026-10-22 12:30:56 JST: videoMinFps = 0).
    const evaluation = evaluateBroadcastHeartbeat(
      geometry({ sweepSeconds: 2.4 }),
    );
    expect(evaluation.sampleRowsPerFrame).toBeLessThan(1);
    expect(evaluation.detectable).toBe(false);
  });

  it("rejects a band that leaves the picture", () => {
    // The band would be gone for a while, and the frames it is gone from do
    // not change at all: the freeze it exists to prevent.
    const evaluation = evaluateBroadcastHeartbeat(
      geometry({ travelVh: 94, bandHeightVh: 8 }),
    );
    expect(evaluation.staysOnScreen).toBe(false);
    expect(evaluation.detectable).toBe(false);
  });

  it("rejects a sweep that is too slow to be seen", () => {
    const evaluation = evaluateBroadcastHeartbeat(
      geometry({ sweepSeconds: 4, deliveryFps: 24 }),
    );
    expect(evaluation.detectable).toBe(false);
  });
});
