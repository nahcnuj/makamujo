import { describe, expect, it } from "bun:test";
import {
  areFramesIdentical,
  DEFAULT_GAME_STALL_CHECK_MS,
  DEFAULT_GAME_STALL_STATIC_FRAMES,
  type GameStallState,
  initialGameStallState,
  observeGameFrame,
  resolveGameStallCheckMs,
  resolveGameStallStaticFrames,
  shouldRestartGameSession,
} from "./gameStall";

const frame = (...bytes: number[]): Uint8Array => Uint8Array.from(bytes);

describe("areFramesIdentical", () => {
  it("is true for equal byte content", () => {
    expect(areFramesIdentical(frame(1, 2, 3), frame(1, 2, 3))).toBe(true);
  });

  it("is false when any byte differs", () => {
    expect(areFramesIdentical(frame(1, 2, 3), frame(1, 2, 4))).toBe(false);
  });

  it("is false when the lengths differ", () => {
    expect(areFramesIdentical(frame(1, 2), frame(1, 2, 3))).toBe(false);
  });

  it("is false when either probe is missing", () => {
    expect(areFramesIdentical(undefined, frame(1))).toBe(false);
    expect(areFramesIdentical(frame(1), undefined)).toBe(false);
  });

  it("is true for two empty frames", () => {
    expect(areFramesIdentical(new Uint8Array(), new Uint8Array())).toBe(true);
  });
});

describe("observeGameFrame", () => {
  const observation = (
    identicalToPrevious: boolean,
    expectedToAnimate = true,
  ) => ({ identicalToPrevious, expectedToAnimate });

  it("never stalls on the first frame because it only establishes a baseline", () => {
    const decision = observeGameFrame(
      initialGameStallState(),
      observation(true),
      1,
    );
    expect(decision.stalled).toBe(false);
    expect(decision.state.hasBaseline).toBe(true);
  });

  it("counts identical frames and trips exactly at the threshold", () => {
    let state: GameStallState = { hasBaseline: true, staticFrames: 0 };
    for (let index = 0; index < 2; index++) {
      const decision = observeGameFrame(state, observation(true), 3);
      expect(decision.stalled).toBe(false);
      state = decision.state;
    }
    const decision = observeGameFrame(state, observation(true), 3);
    expect(decision.stalled).toBe(true);
    expect(decision.state.staticFrames).toBe(0);
  });

  it("clears the counter when the frame changes", () => {
    const decision = observeGameFrame(
      { hasBaseline: true, staticFrames: 4 },
      observation(false),
      6,
    );
    expect(decision.stalled).toBe(false);
    expect(decision.state.staticFrames).toBe(0);
  });

  it("ignores still frames while the screen is not expected to animate", () => {
    const decision = observeGameFrame(
      { hasBaseline: true, staticFrames: 5 },
      observation(true, false),
      2,
    );
    expect(decision.stalled).toBe(false);
    expect(decision.state.staticFrames).toBe(0);
  });
});

describe("shouldRestartGameSession", () => {
  it("is false below the limit and true at or above it", () => {
    expect(shouldRestartGameSession(0, 3)).toBe(false);
    expect(shouldRestartGameSession(2, 3)).toBe(false);
    expect(shouldRestartGameSession(3, 3)).toBe(true);
    expect(shouldRestartGameSession(4, 3)).toBe(true);
  });

  it("is disabled by a non-positive limit", () => {
    expect(shouldRestartGameSession(100, 0)).toBe(false);
    expect(shouldRestartGameSession(100, -1)).toBe(false);
  });
});

describe("resolveGameStallCheckMs", () => {
  it("falls back to the default when unset or blank", () => {
    expect(resolveGameStallCheckMs({})).toBe(DEFAULT_GAME_STALL_CHECK_MS);
    expect(resolveGameStallCheckMs({ GAME_STALL_CHECK_MS: "  " })).toBe(
      DEFAULT_GAME_STALL_CHECK_MS,
    );
  });

  it("uses a positive override and ignores invalid values", () => {
    expect(resolveGameStallCheckMs({ GAME_STALL_CHECK_MS: "2500" })).toBe(2500);
    expect(resolveGameStallCheckMs({ GAME_STALL_CHECK_MS: "-1" })).toBe(
      DEFAULT_GAME_STALL_CHECK_MS,
    );
    expect(resolveGameStallCheckMs({ GAME_STALL_CHECK_MS: "abc" })).toBe(
      DEFAULT_GAME_STALL_CHECK_MS,
    );
  });
});

describe("resolveGameStallStaticFrames", () => {
  it("falls back to the default when unset or blank", () => {
    expect(resolveGameStallStaticFrames({})).toBe(
      DEFAULT_GAME_STALL_STATIC_FRAMES,
    );
  });

  it("uses a positive override and ignores invalid values", () => {
    expect(
      resolveGameStallStaticFrames({ GAME_STALL_STATIC_FRAMES: "2" }),
    ).toBe(2);
    expect(
      resolveGameStallStaticFrames({ GAME_STALL_STATIC_FRAMES: "0" }),
    ).toBe(DEFAULT_GAME_STALL_STATIC_FRAMES);
  });
});
