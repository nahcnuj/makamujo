import { describe, expect, it } from "bun:test";
import {
  GAME_CLIP,
  GAME_MIN_FPS,
  VIDEO_MIN_FPS,
} from "../../../scripts/check-stream";
import {
  BROADCAST_HEARTBEAT_BAND_SPEC,
  computeHeartbeatSampling,
  coreSpanAtPhase,
  DEFAULT_HEARTBEAT_LIVENESS_OPTIONS,
  evaluateHeartbeatLiveness,
  HEARTBEAT_GAME_MIN_FPS,
  HEARTBEAT_GAME_WIDTH_RATIO,
  HEARTBEAT_VIDEO_MIN_FPS,
  type HeartbeatBandSpec,
  offScreenRatio,
  sampleHeartbeatPicture,
  sampleRowsPerFrame,
  summarizeHeartbeatBuckets,
} from "./broadcastHeartbeatLiveness";

/**
 * 2026-10-21 22:27 と 2026-10-22 06:25 の停止（issue #1009）は、音声と
 * media clock が進んだまま映像の全フレームが同じだった。帯はそれを防ぐ
 * ためのもので、検知の閾値（`scripts/check-stream.ts`）を満た能够在ことが
 * 要る。ここでは帯の形を検知そのものと同じ手順で再現し、
 * - 画面外に出る瞬間が無いこと
 * - 1 フレームで標本の 1 行を跨ぐこと
 * - 最悪の 1 秒バケットでも閾値を満たすこと
 * を検査する。
 */

/** 変更前の帯（`src/index.css` の旧定義）。画面外に出る瞬間がある。 */
const PREVIOUS_BAND_SPEC: HeartbeatBandSpec = {
  heightRatio: 0.06,
  sweepFromRatio: -0.12,
  sweepToRatio: 1.12,
  coreRatio: 0.006,
  durationMs: 2_400,
  coreColor: { red: 255, green: 255, blue: 255 },
};

describe("broadcastHeartbeatLiveness", () => {
  it("keeps the thresholds in sync with the external check", () => {
    // `scripts/check-stream.ts` は owner 契約で改変できない。複製した値が
    // ずれると、帯が閾値を満たさないまま「満たしている」と誤認する。
    expect(HEARTBEAT_VIDEO_MIN_FPS).toBe(VIDEO_MIN_FPS);
    expect(HEARTBEAT_GAME_MIN_FPS).toBe(GAME_MIN_FPS);
    expect(HEARTBEAT_GAME_WIDTH_RATIO).toBe(GAME_CLIP.widthRatio);
    expect(DEFAULT_HEARTBEAT_LIVENESS_OPTIONS.maxSampleDimension).toBe(128);
    expect(DEFAULT_HEARTBEAT_LIVENESS_OPTIONS.channelTolerance).toBe(16);
    expect(DEFAULT_HEARTBEAT_LIVENESS_OPTIONS.minChangedRatio).toBe(0.001);
  });

  it("samples the delivered picture the way the check does", () => {
    const sampling = computeHeartbeatSampling(
      DEFAULT_HEARTBEAT_LIVENESS_OPTIONS,
    );
    // 1280x720 の配信画面は 128x72 の標本に縮まり、ゲーム部分は左 60%。
    expect(sampling).toEqual({ width: 128, height: 72, gameWidth: 77 });
  });

  it("keeps the band inside the screen for the whole cycle", () => {
    expect(offScreenRatio(BROADCAST_HEARTBEAT_BAND_SPEC)).toBe(0);
    const report = evaluateHeartbeatLiveness(BROADCAST_HEARTBEAT_BAND_SPEC);
    expect(report.coreAlwaysOnScreen).toBe(true);
    // 帯の下端はちょうど画面の下端に収まる。
    const last = coreSpanAtPhase(BROADCAST_HEARTBEAT_BAND_SPEC, 0.999);
    expect(last.toRatio).toBeLessThanOrEqual(1);
  });

  it("moves more than one sample row per delivered frame", () => {
    const rows = sampleRowsPerFrame(
      BROADCAST_HEARTBEAT_BAND_SPEC,
      DEFAULT_HEARTBEAT_LIVENESS_OPTIONS,
    );
    expect(rows).toBeGreaterThan(1);
  });

  it("keeps the slowest second above the check thresholds", () => {
    const report = evaluateHeartbeatLiveness(BROADCAST_HEARTBEAT_BAND_SPEC);
    expect(report.reasons).toEqual([]);
    expect(report.keepsPictureMoving).toBe(true);
    // 30fps の映像のうち、判定に数えられるのは 1 バケットあたり 30 枚まで。
    expect(report.minWholeChangedFramesPerSecond).toBeGreaterThanOrEqual(
      HEARTBEAT_VIDEO_MIN_FPS,
    );
    expect(report.minGameChangedFramesPerSecond).toBeGreaterThanOrEqual(
      HEARTBEAT_GAME_MIN_FPS,
    );
    // 閾値にぎりぎりではなく余裕があること（描画の丸めや Color Key で
    // 1-2 枚落ちる余地を見込む）。
    expect(report.minWholeChangedFramesPerSecond).toBeGreaterThan(
      HEARTBEAT_VIDEO_MIN_FPS + 2,
    );
  });

  it("moves the game panel too", () => {
    const report = evaluateHeartbeatLiveness(BROADCAST_HEARTBEAT_BAND_SPEC);
    expect(report.minGameChangedFramesPerSecond).toBeGreaterThan(
      HEARTBEAT_GAME_MIN_FPS + 2,
    );
  });

  it("rejects a band that leaves the screen", () => {
    const report = evaluateHeartbeatLiveness(PREVIOUS_BAND_SPEC);
    expect(report.keepsPictureMoving).toBe(false);
    expect(report.offScreenRatio).toBeGreaterThan(0);
    // 変更前の帯は最悪のバケットで閾値を下回っていた。
    expect(report.minWholeChangedFramesPerSecond).toBeLessThan(
      HEARTBEAT_VIDEO_MIN_FPS,
    );
    expect(report.reasons.join(" ")).toContain("leaves the screen");
  });

  it("rejects a band that moves too slowly", () => {
    const slow: HeartbeatBandSpec = {
      ...BROADCAST_HEARTBEAT_BAND_SPEC,
      durationMs: 20_000,
    };
    const report = evaluateHeartbeatLiveness(slow);
    expect(report.keepsPictureMoving).toBe(false);
    expect(report.sampleRowsPerFrame).toBeLessThan(1);
    expect(report.reasons.join(" ")).toContain("sample rows per frame");
  });

  it("needs a contrast against the background", () => {
    // 中核と同じ色の背景の上では、帯は背景と同じ色になって差分が出ない。
    // ゲーム画面の背景は #0f1419 なので今は起きないが、帯が「止まって
    // 見える」条件を固定しておく。
    const sameColor = evaluateHeartbeatLiveness(BROADCAST_HEARTBEAT_BAND_SPEC, {
      ...DEFAULT_HEARTBEAT_LIVENESS_OPTIONS,
      backgroundColor: BROADCAST_HEARTBEAT_BAND_SPEC.coreColor,
    });
    expect(sameColor.minWholeChangedFramesPerSecond).toBe(0);
    expect(sameColor.keepsPictureMoving).toBe(false);
  });

  it("counts the changed frames in one second buckets", () => {
    const options = DEFAULT_HEARTBEAT_LIVENESS_OPTIONS;
    const samples = sampleHeartbeatPicture(
      BROADCAST_HEARTBEAT_BAND_SPEC,
      options,
    );
    const buckets = summarizeHeartbeatBuckets(samples, options);
    expect(buckets).toHaveLength(10);
    for (const bucket of buckets) {
      expect(bucket.wholeChangedFrames).toBeLessThanOrEqual(30);
      expect(bucket.wholeChangedFrames).toBeGreaterThanOrEqual(
        HEARTBEAT_VIDEO_MIN_FPS,
      );
      expect(bucket.gameChangedFrames).toBeGreaterThanOrEqual(
        HEARTBEAT_GAME_MIN_FPS,
      );
    }
  });
});
