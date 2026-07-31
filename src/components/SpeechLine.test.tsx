import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { render } from "hono/jsx/dom";
import {
  graphemeList,
  revealCount,
  revealDurationMs,
  runReveal,
  SpeechLine,
  stripTrailingPeriod,
} from "./SpeechLine";

describe("stripTrailingPeriod", () => {
  it("removes only a trailing 。", () => {
    expect(stripTrailingPeriod("こんにちは。")).toBe("こんにちは");
    expect(stripTrailingPeriod("。。")).toBe("。");
    expect(stripTrailingPeriod("こんにちは")).toBe("こんにちは");
    expect(stripTrailingPeriod("")).toBe("");
  });
});

describe("graphemeList", () => {
  it("counts JP and emoji as graphemes", () => {
    expect(graphemeList("あ！").length).toBe(2);
    expect(graphemeList("a😀b").length).toBe(3);
  });

  it("returns empty for empty string", () => {
    expect(graphemeList("")).toEqual([]);
  });

  it("keeps combining-ish emoji sequences as graphemes", () => {
    const n = graphemeList("👨‍👩‍👧").length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(5);
  });
});

describe("revealDurationMs", () => {
  it("clamps by min/max", () => {
    expect(revealDurationMs(1)).toBe(200);
    expect(revealDurationMs(1000)).toBe(2000);
    expect(revealDurationMs(10)).toBe(450);
  });

  it("scales linearly between clamps", () => {
    expect(revealDurationMs(5)).toBe(225);
    expect(revealDurationMs(4)).toBe(200);
    expect(revealDurationMs(44)).toBe(1980);
    expect(revealDurationMs(45)).toBe(2000);
  });
});

describe("revealCount", () => {
  it("starts at 0 and ends at total", () => {
    expect(revealCount(0, 1000, 10)).toBe(0);
    expect(revealCount(1000, 1000, 10)).toBe(10);
    expect(revealCount(500, 1000, 10)).toBe(5);
  });

  it("never exceeds total", () => {
    expect(revealCount(9999, 1000, 7)).toBe(7);
  });

  it("returns total when duration is 0", () => {
    expect(revealCount(0, 0, 5)).toBe(5);
  });

  it("clamps negative elapsed to 0", () => {
    expect(revealCount(-100, 1000, 10)).toBe(0);
  });

  it("handles total 0", () => {
    expect(revealCount(0, 1000, 0)).toBe(0);
    expect(revealCount(500, 1000, 0)).toBe(0);
  });

  it("rounds up partial progress", () => {
    expect(revealCount(1, 1000, 10)).toBe(1);
  });
});

describe("runReveal", () => {
  it("emits counts up to total then stops", () => {
    const counts: number[] = [];
    const holder: { tick: ((t: number) => void) | null } = { tick: null };
    let cancelled = false;

    const cleanup = runReveal(
      4,
      400,
      (n) => counts.push(n),
      {
        now: () => 0,
        schedule: (fn) => {
          holder.tick = fn;
          return 1;
        },
        cancel: () => {
          cancelled = true;
        },
      },
    );

    expect(counts[0]).toBe(0);
    holder.tick?.(100);
    expect(counts.at(-1)).toBe(1);
    holder.tick?.(200);
    expect(counts.at(-1)).toBe(2);
    holder.tick?.(400);
    expect(counts.at(-1)).toBe(4);

    cleanup();
    expect(cancelled).toBe(true);
  });

  it("handles total 0", () => {
    const counts: number[] = [];
    const cleanup = runReveal(0, 200, (n) => counts.push(n), {
      now: () => 0,
      schedule: () => 0,
      cancel: () => {},
    });
    expect(counts).toEqual([0]);
    cleanup();
  });
});

describe("SpeechLine (render)", () => {
  let root: HTMLElement;
  let rafQueue: Array<(t: number) => void>;
  let now = 0;

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.performance = { now: () => now } as Performance;

    rafQueue = [];
    globalThis.requestAnimationFrame = ((cb: (t: number) => void) => {
      rafQueue.push(cb);
      return rafQueue.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

    root = document.getElementById("root")!;
    now = 0;
  });

  afterEach(() => {
    root.replaceChildren();
  });

  const flushRaf = (t: number) => {
    now = t;
    const q = rafQueue.splice(0);
    for (const cb of q) cb(t);
  };

  it("shows full text immediately when animate is false", () => {
    render(<SpeechLine text="こんにちは。" animate={false} />, root);
    expect(root.textContent).toBe("こんにちは");
  });

  it("reveals text over time when animate is true", async () => {
    render(<SpeechLine text="abcd" animate={true} />, root);

    // useEffect → first rAF
    await Promise.resolve();
    await Promise.resolve();
    expect(root.textContent).toBe("");

    const drain = async (t: number) => {
      flushRaf(t);
      await Promise.resolve();
    };

    // Until something is visible (fake clock only; no real wait)
    for (let t = 0; t <= 2000; t += 16) {
      if ((root.textContent ?? "").length > 0) break;
      await drain(t);
    }
    const mid = root.textContent ?? "";
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.length).toBeLessThan(4);

    // Until complete
    for (let i = 0; i < 120; i++) {
      if ((root.textContent ?? "") === "abcd" && rafQueue.length === 0) break;
      await drain(10_000);
    }
    expect(root.textContent).toBe("abcd");
  });

  it("shows empty string for empty text", () => {
    render(<SpeechLine text="" animate={false} />, root);
    expect(root.textContent).toBe("");
  });
});
