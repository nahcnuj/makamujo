import { describe, expect, it } from "bun:test";
import {
  COMPOSITE_FREEZE_DEFAULT_CONFIG,
  COMPOSITE_FREEZE_RECOVERIES,
  type CompositeFreezeCycle,
  type CompositeFreezeState,
  createCompositeFreezeState,
  observeCompositeFreezeCycle,
} from "./CompositeFreezePolicy";

const stepMs = (cycles: number): number => 60_000 * cycles;

const cycle = (motion: CompositeFreezeCycle["motion"], nowMs: number) => ({
  motion,
  nowMs,
});

/** Run `count` still cycles one minute apart, ending on the last decision. */
const stillStreak = (
  state: CompositeFreezeState,
  startCycle: number,
  count: number,
): ReturnType<typeof observeCompositeFreezeCycle> => {
  let decision = observeCompositeFreezeCycle(
    state,
    cycle("still", stepMs(startCycle)),
  );
  for (let offset = 1; offset < count; offset++) {
    decision = observeCompositeFreezeCycle(
      decision.state,
      cycle("still", stepMs(startCycle + offset)),
    );
  }
  return decision;
};

describe("observeCompositeFreezeCycle", () => {
  it("requires consecutive still cycles before any recovery runs", () => {
    const first = stillStreak(createCompositeFreezeState(), 0, 2);
    expect(first.action).toBeUndefined();

    const third = observeCompositeFreezeCycle(
      first.state,
      cycle("still", stepMs(2)),
    );
    expect(third.action).toBe("obs");
  });

  it("resets the streak, the ladder and the cooldown on a moving picture", () => {
    const first = stillStreak(createCompositeFreezeState(), 0, 3);
    expect(first.action).toBe("obs");

    // The recovery left a 10-minute cooldown anchored to the moment it ran;
    // the next streak may take the second rung only after that has elapsed
    // (run at cycles 11..13, anchored at cycle 13).
    const recovered = stillStreak(first.state, 11, 3);
    expect(recovered.action).toBe("xorgAndObs");

    // The picture moved again: the next streak has to run the first rung, not
    // whatever rung the older freeze had escalated to.
    const moved = observeCompositeFreezeCycle(
      recovered.state,
      cycle("moving", stepMs(20)),
    );
    expect(moved.state.recoveryIndex).toBe(0);
    expect(moved.action).toBeUndefined();

    const second = stillStreak(moved.state, 30, 3);
    expect(second.action).toBe("obs");
  });

  it("does not run a recovery while the cooldown has not elapsed", () => {
    const first = stillStreak(createCompositeFreezeState(), 0, 3);
    expect(first.action).toBe("obs");
    expect(first.state.lastRecoveryAtMs).toBe(stepMs(2));

    // One minute later the picture is still frozen and it has been still for
    // 3 consecutive cycles, but the 10-minute cooldown since the first
    // recovery is far from over, so the next rung is not shaken off.
    const oneCycleLater = observeCompositeFreezeCycle(
      first.state,
      cycle("still", stepMs(3)),
    );
    expect(oneCycleLater.action).toBeUndefined();
    expect(oneCycleLater.state.recoveryIndex).toBe(1);

    // Once the cooldown has elapsed (12 min after the anchor of the first
    // recovery), the next opportunity for a still cycle takes the second rung.
    const afterCooldown = observeCompositeFreezeCycle(
      observeCompositeFreezeCycle(
        oneCycleLater.state,
        cycle("still", stepMs(11)),
      ).state,
      cycle("still", stepMs(12)),
    );
    expect(afterCooldown.action).toBe("xorgAndObs");
  });

  it("walks to the deepest rung and keeps running it", () => {
    const first = stillStreak(createCompositeFreezeState(), 0, 3);
    expect(first.action).toBe("obs");

    const second = stillStreak(first.state, 15, 3);
    expect(second.action).toBe("xorgAndObs");

    const third = stillStreak(second.state, 30, 3);
    expect(third.action).toBe("browserAndBroadcastStack");

    // Past the deepest rung, recovery keeps running the deepest one.
    const fourth = stillStreak(third.state, 45, 3);
    expect(fourth.action).toBe("browserAndBroadcastStack");
  });

  it("resets the streak on unmeasurable cycles too", () => {
    const first = stillStreak(createCompositeFreezeState(), 0, 2);

    // Unmeasurable (advertisement / player rebuild / no video yet) is judged
    // neither still nor moving, but it must not bridge a freeze streak:
    // a mid-roll advertisement freezes the picture like a stall would.
    const unknown = observeCompositeFreezeCycle(
      first.state,
      cycle("unknown", stepMs(2)),
    );
    expect(unknown.state.stillCycles).toBe(0);
    expect(unknown.action).toBeUndefined();

    const third = stillStreak(unknown.state, 3, 3);
    expect(third.action).toBe("obs");
  });

  it("keeps the ladder and the cooldown on unmeasurable cycles", () => {
    // A freeze that already ran the first rung, measured one minute after the
    // recovery (still inside the cooldown).
    const recovered = stillStreak(createCompositeFreezeState(), 0, 3);
    expect(recovered.action).toBe("obs");

    // The stream could not be measured for a while afterwards: the statistics
    // browser was rebuilt by a restart, an advertisement played, the player
    // swapped its element. None of that is evidence that the composite
    // recovered, so the ladder position and the cooldown anchor survive.
    let observed = recovered.state;
    for (let offset = 3; offset <= 10; offset++) {
      const decision = observeCompositeFreezeCycle(
        observed,
        cycle("unknown", stepMs(offset)),
      );
      observed = decision.state;
      expect(decision.action).toBeUndefined();
      expect(observed.recoveryIndex).toBe(1);
      expect(observed.lastRecoveryAtMs).toBe(stepMs(2));
      expect(observed.stillCycles).toBe(0);
    }

    // The picture is still frozen and the cooldown is over: the next clean
    // streak takes the second rung instead of running the first one again.
    const escalated = stillStreak(observed, 11, 3);
    expect(escalated.action).toBe("xorgAndObs");
  });

  it("exposes the default configuration and the recovery ladder", () => {
    expect(COMPOSITE_FREEZE_RECOVERIES).toEqual([
      "obs",
      "xorgAndObs",
      "browserAndBroadcastStack",
    ]);
    expect(COMPOSITE_FREEZE_DEFAULT_CONFIG.cyclesRequired).toBe(3);
    expect(COMPOSITE_FREEZE_DEFAULT_CONFIG.recoveryCooldownMs).toBe(60_000);
  });
});
