import { describe, expect, it } from "bun:test";
import {
  createOverlayLivenessState,
  OVERLAY_LIVENESS_DEFAULT_CONFIG,
  type OverlayLivenessConfig,
  type OverlayLivenessState,
  observeOverlayLiveness,
} from "./OverlayLivenessPolicy";

const MINUTE = 60_000;

const CONFIG: OverlayLivenessConfig = {
  silenceThresholdMs: MINUTE,
  recoveryCooldownMs: 10 * MINUTE,
};

const observe = (
  state: OverlayLivenessState,
  nowMs: number,
  lastBeaconAtMs: number | undefined,
  config: OverlayLivenessConfig = CONFIG,
) => observeOverlayLiveness(state, { nowMs, lastBeaconAtMs }, config);

describe("observeOverlayLiveness", () => {
  it("keeps watching a page that never reported itself", () => {
    // A page that never reported itself may simply not exist (no OBS, no
    // stream). Restarting OBS in that case would be noise, not a recovery.
    const decision = observe(createOverlayLivenessState(), MINUTE, undefined);
    expect(decision.action).toBeUndefined();
    expect(decision.state.lastBeaconAtMs).toBeUndefined();
  });

  it("does not act while the page keeps reporting itself", () => {
    const state = createOverlayLivenessState();
    const first = observe(state, MINUTE, MINUTE);
    expect(first.action).toBeUndefined();
    expect(first.state.lastBeaconAtMs).toBe(MINUTE);

    const second = observe(first.state, 2 * MINUTE, 2 * MINUTE);
    expect(second.action).toBeUndefined();
    expect(second.state.lastBeaconAtMs).toBe(2 * MINUTE);
  });

  it("restarts OBS once the page went silent", () => {
    const alive = observe(createOverlayLivenessState(), MINUTE, MINUTE);
    const silent = observe(alive.state, 3 * MINUTE, MINUTE);
    expect(silent.action).toBe("restartObs");
    expect(silent.state.lastRecoveryAtMs).toBe(3 * MINUTE);
  });

  it("keeps silent within the threshold", () => {
    const alive = observe(createOverlayLivenessState(), MINUTE, MINUTE);
    // One minute of silence is exactly the threshold, so it is still alive.
    const decision = observe(alive.state, 2 * MINUTE, MINUTE);
    expect(decision.action).toBeUndefined();
  });

  it("does not restart OBS again inside the cooldown", () => {
    const alive = observe(createOverlayLivenessState(), MINUTE, MINUTE);
    const first = observe(alive.state, 3 * MINUTE, MINUTE);
    expect(first.action).toBe("restartObs");

    const second = observe(first.state, 4 * MINUTE, MINUTE);
    expect(second.action).toBeUndefined();
    expect(second.state.lastRecoveryAtMs).toBe(3 * MINUTE);
  });

  it("restarts OBS again after the cooldown", () => {
    const alive = observe(createOverlayLivenessState(), MINUTE, MINUTE);
    const first = observe(alive.state, 3 * MINUTE, MINUTE);
    const second = observe(first.state, 3 * MINUTE + 10 * MINUTE, MINUTE);
    expect(second.action).toBe("restartObs");
    expect(second.state.lastRecoveryAtMs).toBe(3 * MINUTE + 10 * MINUTE);
  });

  it("forgets the cooldown once the page reports itself again", () => {
    const alive = observe(createOverlayLivenessState(), MINUTE, MINUTE);
    const first = observe(alive.state, 3 * MINUTE, MINUTE);
    expect(first.action).toBe("restartObs");

    const recovered = observe(first.state, 4 * MINUTE, 4 * MINUTE);
    expect(recovered.action).toBeUndefined();
    expect(recovered.state.lastRecoveryAtMs).toBeUndefined();

    // A new failure may act immediately.
    const again = observe(recovered.state, 6 * MINUTE, 4 * MINUTE);
    expect(again.action).toBe("restartObs");
  });

  it("does not act on a beacon the cycle does not know about", () => {
    // The caller decides which beacon counts: a beacon of a previous process
    // (the server is restarted every 11 minutes) must not be read as a dead
    // page right after the restart.
    const state: OverlayLivenessState = {
      lastBeaconAtMs: MINUTE,
      lastRecoveryAtMs: undefined,
    };
    const decision = observe(state, 3 * MINUTE, undefined);
    expect(decision.action).toBeUndefined();
    expect(decision.state.lastBeaconAtMs).toBe(MINUTE);
  });

  it("keeps the documented defaults", () => {
    // A minute of silence is a dozen lost beacons (the page reports itself
    // every 5 seconds), and the cooldown keeps a page that cannot be loaded
    // from turning into a restart loop.
    expect(OVERLAY_LIVENESS_DEFAULT_CONFIG.silenceThresholdMs).toBe(MINUTE);
    expect(OVERLAY_LIVENESS_DEFAULT_CONFIG.recoveryCooldownMs).toBe(
      10 * MINUTE,
    );
  });
});
