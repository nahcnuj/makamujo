import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BroadcastHeartbeat } from "./BroadcastHeartbeat";

const here = dirname(fileURLToPath(import.meta.url));

describe("BroadcastHeartbeat", () => {
  it("renders a non-interactive overlay marker", () => {
    const element = BroadcastHeartbeat() as unknown as {
      tag: string;
      props: Record<string, unknown>;
    };
    expect(element.tag).toBe("div");
    expect(element.props.className).toBe("broadcast-heartbeat");
    expect(element.props["aria-hidden"]).toBe("true");
  });

  it("sweeps without a static hold", () => {
    const css = readFileSync(join(here, "..", "index.css"), "utf8");
    expect(css).toContain("@keyframes broadcast-heartbeat-sweep");
    // `infinite` で待ちなく回す。`alternate` や一時停止があると、その間の
    // バケットが 0 枚になり外からの検知に停止と数えられる。
    expect(css).toMatch(
      /animation:\s*broadcast-heartbeat-sweep\s+1\.5s\s+linear\s+infinite/,
    );
    expect(css).not.toContain("animation-play-state");
  });

  it("moves at least one sampled row per delivered frame", () => {
    // 検知は映像を 128x72 へ縮める。720p なら標本 1 行 = 10px、配信は 30fps。
    // 帯が 1 フレームで 1 行を動かないと隣接フレームが同じ行に重なり、
    // videoMinFps が 24 を割って「停止」と誤検知される（issue #1025）。
    const css = readFileSync(join(here, "..", "index.css"), "utf8");
    const duration = Number(
      css.match(
        /animation:\s*broadcast-heartbeat-sweep\s+([\d.]+)s\s+linear\s+infinite/,
      )?.[1],
    );
    expect(Number.isFinite(duration)).toBe(true);

    const pictureHeightPx = 720;
    const travelVh = 94;
    const sampleRows = 72;
    const deliveryFps = 30;
    const movementPxPerFrame =
      ((travelVh / 100) * pictureHeightPx) / (duration * deliveryFps);
    const sampleRowsPerFrame =
      movementPxPerFrame / (pictureHeightPx / sampleRows);
    expect(sampleRowsPerFrame).toBeGreaterThan(1);
  });
});
