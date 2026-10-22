import { describe, expect, it } from "bun:test";
import type { BroadcastHeartbeatGeometry } from "./broadcastHeartbeat";
import {
  BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY,
  BROADCAST_HEARTBEAT_MINIMUM_SAMPLE_ROWS_PER_FRAME,
  BROADCAST_HEARTBEAT_SAMPLE_MAX_DIMENSION,
  BROADCAST_HEARTBEAT_SAMPLE_ROWS,
  evaluateBroadcastHeartbeat,
  heartbeatMovementPxPerFrame,
  heartbeatSampleRowsPerFrame,
  heartbeatSampleScale,
  heartbeatStaysOnScreen,
  sampleRowHeightPx,
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
    expect(BROADCAST_HEARTBEAT_SAMPLE_MAX_DIMENSION).toBe(128);
    expect(BROADCAST_HEARTBEAT_SAMPLE_ROWS).toBe(72);
    // 720px の画面では標本 1 行 = 10px。
    expect(sampleRowHeightPx(720)).toBe(10);
    expect(sampleRowHeightPx(1080)).toBe(15);
  });

  it("does not divide by zero when the sample rows are missing", () => {
    expect(sampleRowHeightPx(720, 0)).toBe(720);
  });

  it("moves the band by more than one sample row per delivered frame", () => {
    // 92vh を 1 秒で進むので 30fps では 1 フレームあたり 22.08px になる。
    // 標本 1 行（10px）を 2.21 行ぶん動かす余裕がある。
    expect(heartbeatMovementPxPerFrame(geometry())).toBeCloseTo(22.08, 5);
    expect(heartbeatSampleRowsPerFrame(geometry())).toBeCloseTo(2.208, 5);
    expect(heartbeatSampleRowsPerFrame(geometry())).toBeGreaterThan(
      BROADCAST_HEARTBEAT_MINIMUM_SAMPLE_ROWS_PER_FRAME,
    );
    expect(evaluateBroadcastHeartbeat(geometry()).detectable).toBe(true);
  });

  it("gives up the sample row margin when the band crawls", () => {
    // 2.4 秒に 92vh 進めると 1 フレームあたり 9.4px で、標本 1 行（10px）に
    // 届かない。落ちた標本では帯の縁だけが変わり、非可逆圧縮を 1 往復した
    // だけでは差が消える（余裕がなくなる）。
    const crawling = geometry({ sweepSeconds: 2.4 });
    expect(heartbeatMovementPxPerFrame(crawling)).toBeCloseTo(9.2, 5);
    expect(heartbeatSampleRowsPerFrame(crawling)).toBeCloseTo(0.92, 5);
    expect(evaluateBroadcastHeartbeat(crawling).detectable).toBe(false);
  });

  it("treats a band that does not move as undetectable", () => {
    const frozen = geometry({ sweepSeconds: 0 });
    expect(heartbeatMovementPxPerFrame(frozen)).toBe(0);
    expect(evaluateBroadcastHeartbeat(frozen).detectable).toBe(false);
    const undelivered = geometry({ deliveryFps: 0 });
    expect(heartbeatMovementPxPerFrame(undelivered)).toBe(0);
    expect(evaluateBroadcastHeartbeat(undelivered).detectable).toBe(false);
  });

  it("keeps the band inside the picture", () => {
    expect(heartbeatStaysOnScreen(geometry())).toBe(true);
    // 92vh 進 + 8vh の高さ = ちょうど画面。画面外に出る時間帯は無い。
    expect(geometry().travelVh + geometry().bandHeightVh).toBeLessThanOrEqual(
      100,
    );
    // 画面外まで出る帯は、その間の 1 秒バケットを 0 枚にする。
    expect(heartbeatStaysOnScreen(geometry({ travelVh: 96 }))).toBe(false);
    expect(heartbeatStaysOnScreen(geometry({ bandHeightVh: 0 }))).toBe(false);
    expect(
      evaluateBroadcastHeartbeat(geometry({ travelVh: 96 })).detectable,
    ).toBe(false);
  });
});
