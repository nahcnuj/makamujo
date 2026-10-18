import { describe, expect, it } from "bun:test";
import type { CompositeFreezeRecovery } from "../lib/domain/broadcasting/CompositeFreezePolicy";
import {
  type BroadcastFreezeWatchdogOptions,
  RECOVERY_SERVICES,
  resolveBroadcastFreezeWatchdogEnv,
  startBroadcastFreezeWatchdog,
} from "./broadcastFreezeWatchdog";
import type { PictureMotion } from "./watchPageBrowser";

const moving: PictureMotion = {
  comparedFrames: 60,
  changedFrames: 30,
  windowMs: 3_000,
  tainted: false,
  sawAdvertisement: false,
};

const still: PictureMotion = {
  comparedFrames: 60,
  changedFrames: 1,
  windowMs: 3_000,
  tainted: false,
  sawAdvertisement: false,
};

const silentLog = { log: () => {}, warn: () => {}, error: () => {} };

/** 短い周期で 1 tick ごとに指定された measurement を返す差し替え。 */
const createWatcherOptions = (
  measurements: (PictureMotion | undefined)[],
  overrides: Partial<BroadcastFreezeWatchdogOptions> = {},
): BroadcastFreezeWatchdogOptions & {
  recoveries: CompositeFreezeRecovery[];
} => {
  const recoveries: CompositeFreezeRecovery[] = [];
  return {
    recoveries,
    measurePictureMotion: async () => measurements.shift(),
    isStreamLive: () => true,
    recover: async (recovery) => {
      recoveries.push(recovery);
    },
    log: silentLog,
    // 最初の tick は即座に回る。テストは直後の tick を 1 回待つ。
    ...overrides,
  };
};

const waitTick = async () => {
  await Bun.sleep(10);
};

describe("resolveBroadcastFreezeWatchdogEnv", () => {
  it("keeps the documented defaults", () => {
    const resolved = resolveBroadcastFreezeWatchdogEnv({});
    expect(resolved.intervalMs).toBe(60_000);
    expect(resolved.config.cyclesRequired).toBe(3);
    expect(resolved.config.recoveryCooldownMs).toBe(600_000);
  });

  it("honors the environment overrides", () => {
    const resolved = resolveBroadcastFreezeWatchdogEnv({
      BROADCAST_FREEZE_CHECK_INTERVAL_MS: "10000",
      BROADCAST_FREEZE_CYCLES: "5",
      BROADCAST_FREEZE_RECOVERY_COOLDOWN_MS: "30000",
    });
    expect(resolved.intervalMs).toBe(10_000);
    expect(resolved.config.cyclesRequired).toBe(5);
    expect(resolved.config.recoveryCooldownMs).toBe(30_000);
  });
});

describe("startBroadcastFreezeWatchdog", () => {
  it("recovers once the picture measured still for the required cycles", async () => {
    const options = createWatcherOptions([moving, still, still, still], {
      intervalMs: 5,
      config: { cyclesRequired: 3, recoveryCooldownMs: 60_000 },
    });
    const watchdog = startBroadcastFreezeWatchdog(options);
    await waitTick();
    await waitTick();
    await waitTick();
    await waitTick();
    watchdog.stop();

    expect(options.recoveries).toEqual(["obs"]);
  });

  it("never recovers while the picture keeps moving", async () => {
    const options = createWatcherOptions([moving, moving, moving], {
      intervalMs: 5,
    });
    const watchdog = startBroadcastFreezeWatchdog(options);
    await waitTick();
    await waitTick();
    await waitTick();
    await waitTick();
    watchdog.stop();

    expect(options.recoveries).toEqual([]);
  });

  it("does not count unmeasurable cycles as still", async () => {
    const options = createWatcherOptions([still, undefined, still, still], {
      intervalMs: 5,
      config: { cyclesRequired: 3, recoveryCooldownMs: 60_000 },
    });
    const watchdog = startBroadcastFreezeWatchdog(options);
    await waitTick();
    await waitTick();
    await waitTick();
    await waitTick();
    watchdog.stop();

    // 静止 x2（周期をまたいで連続しない）+ unknown: まだ必要回数に届かない。
    expect(options.recoveries).toEqual([]);
  });

  it("resets when the stream is not live", async () => {
    let live = true;
    const options = createWatcherOptions([still, still, still], {
      isStreamLive: () => live,
      intervalMs: 5,
    });
    const watchdog = startBroadcastFreezeWatchdog(options);
    await waitTick();
    live = false;
    await waitTick();
    await waitTick();
    live = true;
    await waitTick();
    await waitTick();
    watchdog.stop();

    // 放映外の周期で防ぐ: 番組終了後の一枚絵でも回復を打たない。
    expect(options.recoveries).toEqual([]);
  });

  it("stops measuring after stop()", async () => {
    const measurements: (PictureMotion | undefined)[] = [];
    const options = createWatcherOptions([], {
      measurePictureMotion: async () => {
        measurements.push(moving);
        return moving;
      },
      intervalMs: 5,
    });
    const watchdog = startBroadcastFreezeWatchdog(options);
    await waitTick();
    const measuredAtStop = measurements.length;
    watchdog.stop();
    await Bun.sleep(30);

    expect(measurements.length).toBe(measuredAtStop);
  });

  it("maps each recovery rung to the systemd units it restarts", () => {
    expect(RECOVERY_SERVICES.obs).toEqual(["makamujo-obs.service"]);
    expect(RECOVERY_SERVICES.xorgAndObs).toEqual([
      "xorg10.service",
      "makamujo-obs.service",
    ]);
    expect(RECOVERY_SERVICES.browserAndBroadcastStack).toEqual([
      "makamujo-browser.service",
      "xorg10.service",
      "makamujo-obs.service",
    ]);
  });
});
