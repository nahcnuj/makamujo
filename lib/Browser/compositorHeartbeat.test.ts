import { afterEach, describe, expect, it } from "bun:test";
import {
  compositorHeartbeatProbe,
  DEFAULT_COMPOSITOR_HEARTBEAT_CHECK_MS,
  DEFAULT_COMPOSITOR_HEARTBEAT_WEDGED_FRAMES,
  initialCompositorHeartbeatState,
  isCompositorWedged,
  observeCompositorHeartbeat,
  resolveCompositorHeartbeatCheckMs,
  resolveCompositorHeartbeatWedgedFrames,
} from "./compositorHeartbeat";

afterEach(() => {
  // The probe needs `requestAnimationFrame`, which Bun does not provide.
  delete (globalThis as { requestAnimationFrame?: unknown })
    .requestAnimationFrame;
});

const stubRequestAnimationFrame = (fires: boolean): void => {
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
    callback: () => void,
  ): number => {
    if (fires) callback();
    return 0;
  };
};

describe("compositorHeartbeatProbe", () => {
  it("resolves true when the compositor produces a frame", async () => {
    stubRequestAnimationFrame(true);
    await expect(compositorHeartbeatProbe()).resolves.toBe(true);
  });

  it("resolves false when no frame arrives within the budget", async () => {
    stubRequestAnimationFrame(false);
    await expect(compositorHeartbeatProbe()).resolves.toBe(false);
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
  it("is false when a frame arrived", () => {
    expect(isCompositorWedged(true, true)).toBe(false);
  });

  it("is true when no frame arrived while one was expected", () => {
    expect(isCompositorWedged(true, false)).toBe(true);
  });

  it("is true when the probe could not run while one was expected", () => {
    expect(isCompositorWedged(true, undefined)).toBe(true);
  });

  it("is false whenever the screen is not expected to animate", () => {
    expect(isCompositorWedged(false, true)).toBe(false);
    expect(isCompositorWedged(false, false)).toBe(false);
    expect(isCompositorWedged(false, undefined)).toBe(false);
  });
});

describe("observeCompositorHeartbeat", () => {
  const observation = (
    frameProduced: boolean | undefined,
    expectedToAnimate = true,
  ) => ({ frameProduced, expectedToAnimate });

  it("stays healthy while frames arrive", () => {
    const decision = observeCompositorHeartbeat(
      { wedgedFrames: 0 },
      observation(true),
      2,
    );
    expect(decision.wedged).toBe(false);
    expect(decision.state.wedgedFrames).toBe(0);
  });

  it("counts wedged probes and trips exactly at the threshold", () => {
    const state = initialCompositorHeartbeatState();
    const first = observeCompositorHeartbeat(state, observation(false), 2);
    expect(first.wedged).toBe(false);
    expect(first.state.wedgedFrames).toBe(1);
    const second = observeCompositorHeartbeat(
      first.state,
      observation(undefined),
      2,
    );
    expect(second.wedged).toBe(true);
    expect(second.state.wedgedFrames).toBe(0);
  });

  it("clears the counter when a frame arrives again", () => {
    const decision = observeCompositorHeartbeat(
      { wedgedFrames: 1 },
      observation(true),
      2,
    );
    expect(decision.wedged).toBe(false);
    expect(decision.state.wedgedFrames).toBe(0);
  });

  it("ignores a missing frame on a screen that is not expected to animate", () => {
    const decision = observeCompositorHeartbeat(
      { wedgedFrames: 1 },
      observation(false, false),
      2,
    );
    expect(decision.wedged).toBe(false);
    expect(decision.state.wedgedFrames).toBe(0);
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
