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

  it("sweeps faster than the band height per delivered frame, without a static hold", () => {
    const css = readFileSync(join(here, "..", "index.css"), "utf8");
    expect(css).toContain("@keyframes broadcast-heartbeat-sweep");
    // `infinite` で待ちなく回す。`alternate` や一時停止があると、その間の
    // バケットが 0 枚になり外からの検知に停止と数えられる。
    // 0.6 秒 / 124vh は 1 提示フレーム（30fps ≈ 33.3ms）に ≈6.9vh 動くので、
    // 帯の高さ（6vh）を超える: 隣接フレームが帯の中で重ならない。
    expect(css).toMatch(
      /animation:\s*broadcast-heartbeat-sweep\s+0\.6s\s+linear\s+infinite/,
    );
    expect(css).not.toContain("animation-play-state");
  });

  it("uses a contrast gradient that reads over dark and light scenes", () => {
    const css = readFileSync(join(here, "..", "index.css"), "utf8");
    // 濃い画面は白端が光らせ、明るい画面は黒端が沈める。どちらか一方だけの
    // 色だと、背景が帯と同系統の明るさのとき差が許容（16）を割る。
    expect(css).toMatch(
      /\.broadcast-heartbeat\s*[\s\S]*?rgba\(0,\s*0,\s*0,\s*0\.5\)/,
    );
    expect(css).toMatch(
      /\.broadcast-heartbeat\s*[\s\S]*?rgba\(255,\s*255,\s*255,\s*0\.5\)/,
    );
  });
});
