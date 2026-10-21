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
      /animation:\s*broadcast-heartbeat-sweep\s+2\.4s\s+linear\s+infinite/,
    );
    expect(css).not.toContain("animation-play-state");
  });

  it("keeps part of the band on screen for the whole sweep", () => {
    const css = readFileSync(join(here, "..", "index.css"), "utf8");
    const keyframes =
      css.match(/@keyframes broadcast-heartbeat-sweep\s*{([\s\S]*?)\n}/)?.[1] ??
      "";
    const start = keyframes.match(
      /from\s*{\s*transform:\s*translateY\(([-\d.]+)vh\)/,
    )?.[1];
    const end = keyframes.match(
      /to\s*{\s*transform:\s*translateY\(([-\d.]+)vh\)/,
    )?.[1];
    const height = css.match(
      /\.broadcast-heartbeat\s*{[^}]*height:\s*([\d.]+)vh/,
    )?.[1];
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    expect(height).toBeDefined();
    const bandHeight = Number(height);
    const startTop = Number(start);
    const endTop = Number(end);
    // 上端は帯高さぶんより上へ抜けず (下端が画面内)、下端は画面内に残る。
    // 両端で帯が完全に画面外へ出ると、その間だけ「動くものが無い」時間が
    // でき、外からの検知に停止と数えられる。
    expect(startTop).toBeGreaterThanOrEqual(-bandHeight);
    expect(endTop).toBeLessThanOrEqual(100);
    expect(endTop).toBeGreaterThan(startTop);
  });
});
