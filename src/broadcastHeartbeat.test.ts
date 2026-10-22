import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY,
  evaluateBroadcastHeartbeat,
} from "../lib/domain/broadcasting/broadcastHeartbeat";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");
const css = readFileSync(join(here, "index.css"), "utf8");
const app = readFileSync(join(here, "App.tsx"), "utf8");

/**
 * OBS の Color Key が鍵の色からどれだけ離れているかを測る距離。
 * `plugins/obs-filters/data/color_key_filter_v2.effect` と同じ式
 * （`distance(key_color.rgb, GetNonlinearColor(rgb))`）を使う。键の色から
 * 遠い色だけが key out されない。
 */
const obsColorKeyDistance = (
  rgb: readonly [number, number, number],
  keyRgb: readonly [number, number, number],
): number => {
  const nonlinear = (channel: number): number =>
    channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.sqrt(
    rgb.reduce((sum, channel, index) => {
      const key = (keyRgb[index] ?? 0) / 255;
      const delta = key - nonlinear(channel / 255);
      return sum + delta * delta;
    }, 0),
  );
};

/** OBS の Color Key の既定値（similarity 80 / smoothness 50 を 1000 で割る）。 */
const OBS_COLOR_KEY_SIMILARITY = 80 / 1000;
const OBS_COLOR_KEY_SMOOTHNESS = 50 / 1000;

/** リポジトリの OBS シーンが使う鍵の色（0xFF00FF00 = 純緑）。 */
const OBS_COLOR_KEY_KEY = [0, 255, 0] as const;

describe("the shipped heartbeat band", () => {
  it("is static markup outside the React tree", () => {
    const rootIndex = html.indexOf('<div id="root"></div>');
    const bandIndex = html.indexOf('<div class="broadcast-heartbeat"');
    expect(rootIndex).toBeGreaterThanOrEqual(0);
    expect(bandIndex).toBeGreaterThan(rootIndex);
    // React が描画し直しても消えないよう、帯は #root の外にある。
    expect(app).not.toContain("BroadcastHeartbeat");
    expect(app).not.toContain("broadcast-heartbeat");
  });

  it("carries its own style in the same response", () => {
    // CSS ファイル（Tailwind のコンパイル結果）が壊れても帯は動く。
    expect(html).toContain("@keyframes broadcast-heartbeat-sweep");
    expect(html).toContain(".broadcast-heartbeat");
    expect(css).not.toContain("broadcast-heartbeat");
  });

  it("moves faster than the checker can miss", () => {
    const travel = html.match(/to\s*\{\s*transform:\s*translateY\((\d+)vh\)/);
    const height = html.match(/height:\s*(\d+)vh/);
    const animation = html.match(
      /animation:\s*broadcast-heartbeat-sweep\s+([\d.]+)s\s+(\w+)\s+(\w+)\s+(\w+)/,
    );
    expect(travel).not.toBeNull();
    expect(height).not.toBeNull();
    expect(animation).not.toBeNull();

    const geometry = {
      ...BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY,
      travelVh: Number(travel?.[1]),
      bandHeightVh: Number(height?.[1]),
      sweepSeconds: Number(animation?.[1]),
    };
    expect(geometry.travelVh).toBe(
      BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY.travelVh,
    );
    expect(geometry.bandHeightVh).toBe(
      BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY.bandHeightVh,
    );
    expect(geometry.sweepSeconds).toBe(
      BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY.sweepSeconds,
    );
    // 折り返しに待ちが無いこと（`linear` であり `ease` ではない）。
    expect(animation?.[2]).toBe("linear");
    expect(animation?.[3]).toBe("infinite");
    expect(animation?.[4]).toBe("alternate");

    const evaluation = evaluateBroadcastHeartbeat(geometry);
    expect(evaluation.detectable).toBe(true);
    expect(evaluation.staysOnScreen).toBe(true);
  });

  it("is not removed by the OBS color key", () => {
    // 帯は白と黒で描く。OBS の Color Key（純緑）から遠いので key out されない。
    for (const rgb of [
      [255, 255, 255],
      [0, 0, 0],
    ] as const) {
      const distance = obsColorKeyDistance(rgb, OBS_COLOR_KEY_KEY);
      expect(distance).toBeGreaterThan(
        OBS_COLOR_KEY_SIMILARITY + OBS_COLOR_KEY_SMOOTHNESS,
      );
    }
    // 純緑は key out の対象になる（帯を描き直さないことの理由）。
    expect(obsColorKeyDistance([16, 185, 129], OBS_COLOR_KEY_KEY)).toBeLessThan(
      1,
    );
  });

  it("covers the whole width so the game crop also sees it", () => {
    expect(html).toContain("left: 0;");
    expect(html).toContain("right: 0;");
    expect(html).toContain("position: fixed;");
  });
});
