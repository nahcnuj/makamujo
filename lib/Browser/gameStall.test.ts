import { describe, expect, it } from "bun:test";
import {
  areFramesIdentical,
  DEFAULT_GAME_STALL_CHECK_MS,
  DEFAULT_GAME_STALL_STATIC_FRAMES,
  type GameStallState,
  initialGameStallState,
  initialStallEscalationState,
  observeGameFrame,
  observeStallProbe,
  resolveGameStallCheckMs,
  resolveGameStallStaticFrames,
  type StallEscalationState,
  shouldRestartGameSession,
} from "./gameStall";

const frame = (...bytes: number[]): Uint8Array => Uint8Array.from(bytes);

const MAX_STALLS = 3;

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

describe("observeStallProbe", () => {
  const stalled: StallEscalationState = { consecutiveStalls: 0 };

  it("does nothing while the page is painting", () => {
    const decision = observeStallProbe(
      stalled,
      { stalled: false, frameChanged: true },
      3,
    );
    expect(decision.reload).toBe(false);
    expect(decision.restartSession).toBe(false);
    expect(decision.state.consecutiveStalls).toBe(0);
  });

  it("clears a running budget only when the frame actually changed", () => {
    const running: StallEscalationState = { consecutiveStalls: 2 };
    expect(
      observeStallProbe(running, { stalled: false, frameChanged: true }, 3)
        .state.consecutiveStalls,
    ).toBe(0);
    expect(
      observeStallProbe(running, { stalled: false, frameChanged: false }, 3)
        .state.consecutiveStalls,
    ).toBe(2);
  });

  it("reloads and increments the budget on a stall", () => {
    const decision = observeStallProbe(
      stalled,
      { stalled: true, frameChanged: false },
      3,
    );
    expect(decision.reload).toBe(true);
    expect(decision.restartSession).toBe(false);
    expect(decision.state.consecutiveStalls).toBe(1);
  });

  it("restarts the session once the budget is spent and resets it", () => {
    const decision = observeStallProbe(
      { consecutiveStalls: 2 },
      { stalled: true, frameChanged: false },
      3,
    );
    expect(decision.restartSession).toBe(true);
    expect(decision.reload).toBe(false);
    expect(decision.state.consecutiveStalls).toBe(0);
  });

  it("reaches the session restart across reloads that never recover", () => {
    // Regression: the post-reload baseline reports `frameChanged === false`, so
    // it must not clear the budget, or the restart threshold is never reached
    // and the stream stays frozen while the page is reloaded forever.
    let state = initialStallEscalationState();
    const probe = (stalledNow: boolean, frameChanged: boolean) => {
      const decision = observeStallProbe(
        state,
        { stalled: stalledNow, frameChanged },
        MAX_STALLS,
      );
      state = decision.state;
      return decision;
    };
    expect(probe(true, false).reload).toBe(true);
    expect(probe(false, false).reload).toBe(false);
    expect(probe(true, false).reload).toBe(true);
    expect(probe(false, false).reload).toBe(false);
    const escalation = probe(true, false);
    expect(escalation.restartSession).toBe(true);
    expect(state.consecutiveStalls).toBe(0);
  });

  it("keeps reloading without restarting when the limit is non-positive", () => {
    const decision = observeStallProbe(
      { consecutiveStalls: 100 },
      { stalled: true, frameChanged: false },
      0,
    );
    expect(decision.reload).toBe(true);
    expect(decision.restartSession).toBe(false);
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
