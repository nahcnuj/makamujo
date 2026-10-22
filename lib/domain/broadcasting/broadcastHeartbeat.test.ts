import { describe, expect, it } from "bun:test";
import {
  BROADCAST_HEARTBEAT_SAMPLE_ROWS,
  BROADCAST_HEARTBEAT_SWEEP_SECONDS,
  BROADCAST_HEARTBEAT_SWEEP_TRAVEL_VH,
  DEFAULT_HEARTBEAT_BAND_GEOMETRY,
  heartbeatMovementPxPerFrame,
  keepsSampleRowMargin,
  sampleRowHeightPx,
} from "./broadcastHeartbeat";

describe("broadcastHeartbeat", () => {
  it("maps one sample row onto the picture height", () => {
    // 検知側は 128x72 に落とすので、720px の画面では 1 行 = 10px。
    expect(sampleRowHeightPx(720, 72)).toBeCloseTo(10, 5);
    expect(sampleRowHeightPx(1080, 72)).toBeCloseTo(15, 5);
    // 標本行数が無いときは 0 除算しない。
    expect(sampleRowHeightPx(720, 0)).toBe(720);
  });

  it("moves the band by more than one sample row per delivered frame", () => {
    // 既定の帯: 1.5 秒に 94vh = 676.8px 進むので、30fps では 1 フレーム
    // あたり 15.04px。標本 1 行（10px）を 1.5 行ぶん超える。
    const movement = heartbeatMovementPxPerFrame(
      DEFAULT_HEARTBEAT_BAND_GEOMETRY,
    );
    expect(movement).toBeCloseTo(15.04, 2);
    expect(movement).toBeGreaterThan(
      sampleRowHeightPx(
        DEFAULT_HEARTBEAT_BAND_GEOMETRY.pictureHeightPx,
        DEFAULT_HEARTBEAT_BAND_GEOMETRY.sampleRows,
      ),
    );
    expect(keepsSampleRowMargin(DEFAULT_HEARTBEAT_BAND_GEOMETRY)).toBe(true);
  });

  it("gives up the sample row margin when the band crawls", () => {
    // 2.4 秒に 94vh 進めると 1 フレームあたり 9.4px で、標本 1 行
    // （10px）に届かない。落ちた標本では帯の縁だけが変わり、非可逆圧縮を
    // 1 往復しただけでは差が消える（余裕がなくなる）。
    expect(
      keepsSampleRowMargin({
        ...DEFAULT_HEARTBEAT_BAND_GEOMETRY,
        sweepSeconds: 2.4,
      }),
    ).toBe(false);
  });

  it("treats a frozen band as having no margin", () => {
    expect(
      keepsSampleRowMargin({
        ...DEFAULT_HEARTBEAT_BAND_GEOMETRY,
        sweepSeconds: 0,
      }),
    ).toBe(false);
    expect(
      heartbeatMovementPxPerFrame({
        ...DEFAULT_HEARTBEAT_BAND_GEOMETRY,
        deliveryFps: 0,
      }),
    ).toBe(0);
  });

  it("keeps the documented sweep inside the picture", () => {
    // 帯の高さと進む距離は帯が画面から消えない範囲に収める。
    expect(BROADCAST_HEARTBEAT_SWEEP_TRAVEL_VH).toBe(94);
    expect(BROADCAST_HEARTBEAT_SWEEP_SECONDS).toBe(1.5);
    expect(BROADCAST_HEARTBEAT_SAMPLE_ROWS).toBe(72);
  });
});
