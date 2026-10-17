import { describe, expect, it } from "bun:test";
import {
  DEFAULT_GAME_ACTIVITY_TIMEOUT_MS,
  type GameActivityState,
  initialGameActivityState,
  observeGameActivity,
  resolveGameActivityTimeoutMs,
} from "./GameActivityPolicy";

const observation = (playing: boolean, nowMs: number) => ({ playing, nowMs });

describe("observeGameActivity", () => {
  it("clears the clock while the round is playing", () => {
    const state: GameActivityState = { nonPlayingSinceMs: 1_000 };
    const decision = observeGameActivity(
      state,
      observation(true, 50_000),
      10_000,
    );
    expect(decision.restart).toBe(false);
    expect(decision.state.nonPlayingSinceMs).toBeUndefined();
  });

  it("starts the clock on the first non-playing sight without restarting", () => {
    const decision = observeGameActivity(
      initialGameActivityState(),
      observation(false, 5_000),
      10_000,
    );
    expect(decision.restart).toBe(false);
    expect(decision.state.nonPlayingSinceMs).toBe(5_000);
  });

  it("keeps the clock running across non-playing sights before the timeout", () => {
    let state = observeGameActivity(
      initialGameActivityState(),
      observation(false, 5_000),
      10_000,
    ).state;
    const decision = observeGameActivity(
      state,
      observation(false, 14_000),
      10_000,
    );
    expect(decision.restart).toBe(false);
    state = decision.state;
    expect(state.nonPlayingSinceMs).toBe(5_000);
  });

  it("trips exactly at the timeout", () => {
    const decision = observeGameActivity(
      { nonPlayingSinceMs: 5_000 },
      observation(false, 15_000),
      10_000,
    );
    expect(decision.restart).toBe(true);
  });

  it("resets the clock when it trips so the round is retried, not hammered", () => {
    const decision = observeGameActivity(
      { nonPlayingSinceMs: 5_000 },
      observation(false, 15_000),
      10_000,
    );
    expect(decision.state.nonPlayingSinceMs).toBe(15_000);
    const again = observeGameActivity(
      decision.state,
      observation(false, 16_000),
      10_000,
    );
    expect(again.restart).toBe(false);
  });

  it("restarts a round that returns to playing and stalls again", () => {
    const playing = observeGameActivity(
      { nonPlayingSinceMs: 5_000 },
      observation(true, 20_000),
      10_000,
    );
    expect(playing.state.nonPlayingSinceMs).toBeUndefined();
    const stalled = observeGameActivity(
      playing.state,
      observation(false, 25_000),
      10_000,
    );
    expect(stalled.restart).toBe(false);
    const decision = observeGameActivity(
      stalled.state,
      observation(false, 35_000),
      10_000,
    );
    expect(decision.restart).toBe(true);
  });

  it("is disabled by a non-positive timeout", () => {
    const decision = observeGameActivity(
      { nonPlayingSinceMs: 0 },
      observation(false, 1_000_000),
      0,
    );
    expect(decision.restart).toBe(false);
    expect(
      observeGameActivity(
        { nonPlayingSinceMs: 0 },
        observation(false, 1_000_000),
        -1,
      ).restart,
    ).toBe(false);
  });
});

describe("resolveGameActivityTimeoutMs", () => {
  it("falls back to the default when unset or blank", () => {
    expect(resolveGameActivityTimeoutMs({})).toBe(
      DEFAULT_GAME_ACTIVITY_TIMEOUT_MS,
    );
    expect(
      resolveGameActivityTimeoutMs({ GAME_ACTIVITY_TIMEOUT_MS: "  " }),
    ).toBe(DEFAULT_GAME_ACTIVITY_TIMEOUT_MS);
  });

  it("uses a positive override and ignores invalid values", () => {
    expect(
      resolveGameActivityTimeoutMs({ GAME_ACTIVITY_TIMEOUT_MS: "30000" }),
    ).toBe(30_000);
    expect(
      resolveGameActivityTimeoutMs({ GAME_ACTIVITY_TIMEOUT_MS: "0" }),
    ).toBe(DEFAULT_GAME_ACTIVITY_TIMEOUT_MS);
    expect(
      resolveGameActivityTimeoutMs({ GAME_ACTIVITY_TIMEOUT_MS: "-5" }),
    ).toBe(DEFAULT_GAME_ACTIVITY_TIMEOUT_MS);
    expect(
      resolveGameActivityTimeoutMs({ GAME_ACTIVITY_TIMEOUT_MS: "abc" }),
    ).toBe(DEFAULT_GAME_ACTIVITY_TIMEOUT_MS);
  });
});
