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
      /animation:\s*broadcast-heartbeat-sweep\s+0\.9s\s+linear\s+infinite/,
    );
    expect(css).not.toContain("animation-play-state");
  });
});
