import { afterEach, describe, expect, it } from "bun:test";
import {
  compositorHeartbeatProbe,
  DEFAULT_COMPOSITOR_HEARTBEAT_CHECK_MS,
  DEFAULT_COMPOSITOR_HEARTBEAT_MIN_FPS,
  DEFAULT_COMPOSITOR_HEARTBEAT_WEDGED_FRAMES,
  initialCompositorHeartbeatState,
  isCompositorWedged,
  minFramesWithinBudget,
  observeCompositorHeartbeat,
  resolveCompositorHeartbeatCheckMs,
  resolveCompositorHeartbeatMinFps,
  resolveCompositorHeartbeatWedgedFrames,
} from "./compositorHeartbeat";

afterEach(() => {
  // The probe needs `requestAnimationFrame`, which Bun does not provide.
  delete (globalThis as { requestAnimationFrame?: unknown })
    .requestAnimationFrame;
});

/**
 * Let the probe schedule at most `totalTicks` callbacks. Firing them all from
 * the microtask queue would starve the timer the probe resolves on, so the
 * stub stops scheduling once the budget of callbacks is spent.
 */
const stubRequestAnimationFrame = (totalTicks: number): void => {
  let scheduled = 0;
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
    callback: () => void,
  ): number => {
    if (scheduled < totalTicks) {
      scheduled += 1;
      queueMicrotask(callback);
    }
    return 0;
  };
};

describe("compositorHeartbeatProbe", () => {
  it("counts the frames the compositor produced within the budget", async () => {
    stubRequestAnimationFrame(60);
    await expect(compositorHeartbeatProbe()).resolves.toBe(60);
  });

  it("resolves zero when no frame arrives within the budget", async () => {
    stubRequestAnimationFrame(0);
    await expect(compositorHeartbeatProbe()).resolves.toBe(0);
  });

  it("stays self-contained for the eval-from-source evaluate path", () => {
    const source = compositorHeartbeatProbe.toString();
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("setTimeout");
    // The budget must be a literal: a reference to module scope would be a
    // ReferenceError in the page, where the probe is re-created from source.
    expect(source).not.toContain("COMPOSITOR_HEARTBEAT_PROBE_BUDGET_MS");
    expect(source).not.toContain("budgetMs");
  });
});

describe("isCompositorWedged", () => {
  it("is false when enough frames arrived", () => {
    expect(isCompositorWedged(true, 30, 30)).toBe(false);
    expect(isCompositorWedged(true, 180, 30)).toBe(false);
  });

  it("is true when frames arrived too slowly to keep the stream moving", () => {
    // Observed on the wedged stream: the probe answered with a handful of
    // frames while the picture the stream showed froze for the whole check.
    expect(isCompositorWedged(true, 4, 30)).toBe(true);
    expect(isCompositorWedged(true, 0, 30)).toBe(true);
  });

  it("is true when the probe could not run while one was expected", () => {
    expect(isCompositorWedged(true, undefined, 30)).toBe(true);
  });

  it("is false whenever the screen is not expected to animate", () => {
    expect(isCompositorWedged(false, 0, 30)).toBe(false);
    expect(isCompositorWedged(false, 30, 30)).toBe(false);
    expect(isCompositorWedged(false, undefined, 30)).toBe(false);
  });
});

describe("observeCompositorHeartbeat", () => {
  const observation = (
    frameCount: number | undefined,
    expectedToAnimate = true,
  ) => ({ frameCount, expectedToAnimate });
  const MIN_FRAMES = 30;

  it("stays healthy while frames arrive at the display rate", () => {
    const decision = observeCompositorHeartbeat(
      { wedgedFrames: 0 },
      observation(180),
      2,
      MIN_FRAMES,
    );
    expect(decision.wedged).toBe(false);
    expect(decision.state.wedgedFrames).toBe(0);
  });

  it("counts a starved compositor exactly like a wedged one", () => {
    // 1.4 fps of picture, as the health checker measured it, is four frames
    // in the probe's budget — far below the floor, so it must escalate.
    const state = initialCompositorHeartbeatState();
    const first = observeCompositorHeartbeat(
      state,
      observation(4),
      2,
      MIN_FRAMES,
    );
    expect(first.wedged).toBe(false);
    expect(first.state.wedgedFrames).toBe(1);
    const second = observeCompositorHeartbeat(
      first.state,
      observation(0),
      2,
      MIN_FRAMES,
    );
    expect(second.wedged).toBe(true);
    expect(second.state.wedgedFrames).toBe(0);
  });

  it("counts wedged probes and trips exactly at the threshold", () => {
    const state = initialCompositorHeartbeatState();
    const first = observeCompositorHeartbeat(
      state,
      observation(undefined),
      2,
      MIN_FRAMES,
    );
    expect(first.wedged).toBe(false);
    expect(first.state.wedgedFrames).toBe(1);
    const second = observeCompositorHeartbeat(
      first.state,
      observation(undefined),
      2,
      MIN_FRAMES,
    );
    expect(second.wedged).toBe(true);
    expect(second.state.wedgedFrames).toBe(0);
  });

  it("clears the counter when the frames pick up again", () => {
    const decision = observeCompositorHeartbeat(
      { wedgedFrames: 1 },
      observation(60),
      2,
      MIN_FRAMES,
    );
    expect(decision.wedged).toBe(false);
    expect(decision.state.wedgedFrames).toBe(0);
  });

  it("ignores a starved frame rate on a screen that is not expected to animate", () => {
    const decision = observeCompositorHeartbeat(
      { wedgedFrames: 1 },
      observation(0, false),
      2,
      MIN_FRAMES,
    );
    expect(decision.wedged).toBe(false);
    expect(decision.state.wedgedFrames).toBe(0);
  });
});

describe("minFramesWithinBudget", () => {
  it("turns the default floor into frames per probe budget", () => {
    expect(DEFAULT_COMPOSITOR_HEARTBEAT_MIN_FPS).toBe(10);
    expect(minFramesWithinBudget(10, 3_000)).toBe(30);
    expect(minFramesWithinBudget(DEFAULT_COMPOSITOR_HEARTBEAT_MIN_FPS)).toBe(
      30,
    );
  });

  it("always demands at least one frame", () => {
    expect(minFramesWithinBudget(0, 3_000)).toBe(1);
  });

  it("scales with a custom budget", () => {
    expect(minFramesWithinBudget(24, 1_000)).toBe(24);
  });
});

describe("resolveCompositorHeartbeatCheckMs", () => {
  it("falls back to the default when unset or blank", () => {
    expect(resolveCompositorHeartbeatCheckMs({})).toBe(
      DEFAULT_COMPOSITOR_HEARTBEAT_CHECK_MS,
    );
    expect(
      resolveCompositorHeartbeatCheckMs({ COMPOSITOR_HEARTBEAT_CHECK_MS: " " }),
    ).toBe(DEFAULT_COMPOSITOR_HEARTBEAT_CHECK_MS);
  });

  it("uses a positive override and ignores invalid values", () => {
    expect(
      resolveCompositorHeartbeatCheckMs({
        COMPOSITOR_HEARTBEAT_CHECK_MS: "2500",
      }),
    ).toBe(2_500);
    expect(
      resolveCompositorHeartbeatCheckMs({
        COMPOSITOR_HEARTBEAT_CHECK_MS: "-1",
      }),
    ).toBe(DEFAULT_COMPOSITOR_HEARTBEAT_CHECK_MS);
    expect(
      resolveCompositorHeartbeatCheckMs({
        COMPOSITOR_HEARTBEAT_CHECK_MS: "abc",
      }),
    ).toBe(DEFAULT_COMPOSITOR_HEARTBEAT_CHECK_MS);
  });
});

describe("resolveCompositorHeartbeatWedgedFrames", () => {
  it("falls back to the default when unset or blank", () => {
    expect(resolveCompositorHeartbeatWedgedFrames({})).toBe(
      DEFAULT_COMPOSITOR_HEARTBEAT_WEDGED_FRAMES,
    );
    expect(
      resolveCompositorHeartbeatWedgedFrames({
        COMPOSITOR_HEARTBEAT_WEDGED_FRAMES: "  ",
      }),
    ).toBe(DEFAULT_COMPOSITOR_HEARTBEAT_WEDGED_FRAMES);
  });

  it("uses a positive override and ignores invalid values", () => {
    expect(
      resolveCompositorHeartbeatWedgedFrames({
        COMPOSITOR_HEARTBEAT_WEDGED_FRAMES: "4",
      }),
    ).toBe(4);
    expect(
      resolveCompositorHeartbeatWedgedFrames({
        COMPOSITOR_HEARTBEAT_WEDGED_FRAMES: "0",
      }),
    ).toBe(DEFAULT_COMPOSITOR_HEARTBEAT_WEDGED_FRAMES);
  });
});

describe("resolveCompositorHeartbeatMinFps", () => {
  it("falls back to the default when unset or blank", () => {
    expect(resolveCompositorHeartbeatMinFps({})).toBe(
      DEFAULT_COMPOSITOR_HEARTBEAT_MIN_FPS,
    );
    expect(
      resolveCompositorHeartbeatMinFps({
        COMPOSITOR_HEARTBEAT_MIN_FPS: "  ",
      }),
    ).toBe(DEFAULT_COMPOSITOR_HEARTBEAT_MIN_FPS);
  });

  it("uses a positive override and ignores invalid values", () => {
    expect(
      resolveCompositorHeartbeatMinFps({ COMPOSITOR_HEARTBEAT_MIN_FPS: "24" }),
    ).toBe(24);
    expect(
      resolveCompositorHeartbeatMinFps({ COMPOSITOR_HEARTBEAT_MIN_FPS: "0" }),
    ).toBe(DEFAULT_COMPOSITOR_HEARTBEAT_MIN_FPS);
    expect(
      resolveCompositorHeartbeatMinFps({ COMPOSITOR_HEARTBEAT_MIN_FPS: "abc" }),
    ).toBe(DEFAULT_COMPOSITOR_HEARTBEAT_MIN_FPS);
  });
});
