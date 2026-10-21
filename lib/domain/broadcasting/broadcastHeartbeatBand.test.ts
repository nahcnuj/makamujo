import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROWSER_SOURCE_FPS,
  bandKeepsPictureMoving,
  minVisibleBandHeightVh,
  movementPxPerFrame,
  parseHeartbeatBandSpec,
  sampleRowHeightPx,
} from "./broadcastHeartbeatBand";

const here = dirname(fileURLToPath(import.meta.url));
const stylesheet = readFileSync(
  join(here, "..", "..", "..", "src", "index.css"),
  "utf8",
);

/** The picture OBS delivers: the browser source is 1280x720. */
const VIEWPORT_HEIGHT_PX = 720;

describe("broadcast heartbeat band", () => {
  it("reads the band out of the stylesheet", () => {
    const spec = parseHeartbeatBandSpec(stylesheet);
    expect(spec.bandHeightVh).toBe(6);
    expect(spec.fromVh).toBe(0);
    expect(spec.toVh).toBe(94);
    expect(spec.legDurationMs).toBe(1800);
    expect(spec.alternate).toBe(true);
    // 不透明な芯がある。半透明だと OBS の Color Key（key = 黒）で薄まる。
    expect(spec.coreColor).toBeDefined();
  });

  it("keeps the band inside the viewport for the whole sweep", () => {
    const spec = parseHeartbeatBandSpec(stylesheet);
    // 帯が画面外に出ると、その瞬間を含む 1 秒バケットが 24 枚を下回り、
    // 「映像全体が停止している」と判定される（実測で videoMinFps 20）。
    expect(minVisibleBandHeightVh(spec)).toBeGreaterThan(0);
  });

  it("moves faster than one sample row per frame", () => {
    const spec = parseHeartbeatBandSpec(stylesheet);
    expect(
      movementPxPerFrame(spec, VIEWPORT_HEIGHT_PX, BROWSER_SOURCE_FPS),
    ).toBeGreaterThan(sampleRowHeightPx(VIEWPORT_HEIGHT_PX));
  });

  it("keeps the delivered picture moving on its own", () => {
    const spec = parseHeartbeatBandSpec(stylesheet);
    expect(bandKeepsPictureMoving(spec, VIEWPORT_HEIGHT_PX)).toBe(true);
  });

  it("rejects a band that leaves the viewport", () => {
    const spec = {
      ...parseHeartbeatBandSpec(stylesheet),
      fromVh: -12,
      toVh: 112,
    };
    expect(minVisibleBandHeightVh(spec)).toBe(0);
    expect(bandKeepsPictureMoving(spec, VIEWPORT_HEIGHT_PX)).toBe(false);
  });

  it("rejects a band slower than one sample row per frame", () => {
    const spec = {
      ...parseHeartbeatBandSpec(stylesheet),
      legDurationMs: 6_000,
    };
    expect(
      movementPxPerFrame(spec, VIEWPORT_HEIGHT_PX, BROWSER_SOURCE_FPS),
    ).toBeLessThan(sampleRowHeightPx(VIEWPORT_HEIGHT_PX));
    expect(bandKeepsPictureMoving(spec, VIEWPORT_HEIGHT_PX)).toBe(false);
  });

  it("refuses a stylesheet without a sweeping band", () => {
    expect(() => parseHeartbeatBandSpec("body { color: red; }")).toThrow(
      /broadcast-heartbeat-sweep keyframes not found/,
    );
    const paused = stylesheet.replace(
      "animation: broadcast-heartbeat-sweep 1.8s linear infinite alternate;",
      "animation: broadcast-heartbeat-sweep 1.8s linear 1;",
    );
    expect(() => parseHeartbeatBandSpec(paused)).toThrow(
      /the band must keep sweeping/,
    );
  });
});
