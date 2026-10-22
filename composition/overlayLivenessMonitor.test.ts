import { describe, expect, it } from "bun:test";
import { createOverlayLivenessState } from "../lib/domain/broadcasting/OverlayLivenessPolicy";
import {
  createOverlayBeaconTracker,
  OVERLAY_BEACON_PATH,
  type OverlayLivenessMonitorOptions,
  resolveOverlayLivenessEnv,
  startOverlayLivenessMonitor,
} from "./overlayLivenessMonitor";

const silentLog = { log: () => {}, warn: () => {}, error: () => {} };

const createMonitorOptions = (
  overrides: Partial<OverlayLivenessMonitorOptions> = {},
): OverlayLivenessMonitorOptions & { recoveries: string[] } => {
  const recoveries: string[] = [];
  return {
    recoveries,
    tracker: createOverlayBeaconTracker(),
    recover: async (action) => {
      recoveries.push(action);
    },
    config: {
      silenceThresholdMs: 1_000,
      recoveryCooldownMs: 60_000,
    },
    intervalMs: 60_000,
    log: silentLog,
    ...overrides,
  };
};

describe("overlay liveness monitor", () => {
  it("exposes the path the overlay page reports itself to", () => {
    expect(OVERLAY_BEACON_PATH).toBe("/api/overlay-beacon");
  });

  it("remembers the last beacon", () => {
    const tracker = createOverlayBeaconTracker();
    expect(tracker.lastBeaconAtMs()).toBeUndefined();
    tracker.record(1_234);
    expect(tracker.lastBeaconAtMs()).toBe(1_234);
    tracker.record(5_678);
    expect(tracker.lastBeaconAtMs()).toBe(5_678);
  });

  it("does not restart OBS while the page keeps reporting itself", async () => {
    const options = createMonitorOptions();
    const monitor = startOverlayLivenessMonitor(options);
    try {
      options.tracker.record(Date.now());
      await monitor.tick();
      expect(options.recoveries).toEqual([]);
    } finally {
      monitor.stop();
    }
  });

  it("restarts OBS when the page stopped reporting itself", async () => {
    const options = createMonitorOptions();
    const monitor = startOverlayLivenessMonitor(options);
    try {
      // A beacon from long enough ago: the page is gone.
      options.tracker.record(Date.now() - 10_000);
      await monitor.tick();
      expect(options.recoveries).toEqual(["restartObs"]);
    } finally {
      monitor.stop();
    }
  });

  it("keeps the state across the restarts of the server", async () => {
    const saved: unknown[] = [];
    const options = createMonitorOptions({
      stateStore: {
        load: () => createOverlayLivenessState(),
        save: (state) => {
          saved.push(state);
        },
      },
    });
    const monitor = startOverlayLivenessMonitor(options);
    try {
      options.tracker.record(Date.now() - 10_000);
      await monitor.tick();
      expect(options.recoveries).toEqual(["restartObs"]);
      expect(saved.length).toBeGreaterThan(0);
    } finally {
      monitor.stop();
    }
  });

  it("does not restart OBS right after the server was restarted", async () => {
    // The server is restarted every 11 minutes and the beacon of the page
    // lives in the process. The remembered beacon of the previous process is
    // already minutes old, so it must not be read as a dead page before the
    // page had the time to report itself again.
    const options = createMonitorOptions({
      config: { silenceThresholdMs: 50, recoveryCooldownMs: 60_000 },
      stateStore: {
        load: () => ({
          lastBeaconAtMs: Date.now() - 10_000,
          lastRecoveryAtMs: undefined,
        }),
        save: () => {},
      },
    });
    const monitor = startOverlayLivenessMonitor(options);
    try {
      await monitor.tick();
      expect(options.recoveries).toEqual([]);

      await Bun.sleep(60);
      await monitor.tick();
      expect(options.recoveries).toEqual(["restartObs"]);
    } finally {
      monitor.stop();
    }
  });

  it("survives a failing recovery", async () => {
    const options = createMonitorOptions({
      recover: async () => {
        throw new Error("systemctl failed");
      },
    });
    const monitor = startOverlayLivenessMonitor(options);
    try {
      options.tracker.record(Date.now() - 10_000);
      await monitor.tick();
      // The tick must not throw: the monitor has to keep watching.
    } finally {
      monitor.stop();
    }
  });

  it("reads the settings from the environment", () => {
    const resolved = resolveOverlayLivenessEnv({
      OVERLAY_LIVENESS_CHECK_INTERVAL_MS: "5000",
      OVERLAY_LIVENESS_SILENCE_THRESHOLD_MS: "30000",
      OVERLAY_LIVENESS_RECOVERY_COOLDOWN_MS: "120000",
    });
    expect(resolved.intervalMs).toBe(5000);
    expect(resolved.config.silenceThresholdMs).toBe(30000);
    expect(resolved.config.recoveryCooldownMs).toBe(120000);
  });

  it("falls back to the defaults for broken settings", () => {
    const resolved = resolveOverlayLivenessEnv({
      OVERLAY_LIVENESS_CHECK_INTERVAL_MS: "0",
      OVERLAY_LIVENESS_SILENCE_THRESHOLD_MS: "not-a-number",
    });
    expect(resolved.intervalMs).toBe(30_000);
    expect(resolved.config.silenceThresholdMs).toBe(60_000);
  });
});
