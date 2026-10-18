import { describe, expect, it } from "bun:test";
import type { CompositeFreezeRecovery } from "../lib/domain/broadcasting/CompositeFreezePolicy";
import {
  type BroadcastFreezeWatchdogOptions,
  RECOVERY_SERVICES,
  resolveBroadcastFreezeWatchdogEnv,
  restartServices,
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
    // :10 の実体は ansible が導入する makamujo-xvfb.service。ここを
    // リポジトリ同梱の xorg10.service にすると本番に unit が無く、
    // systemctl restart が失敗してラングが進まない。
    expect(RECOVERY_SERVICES.obs).toEqual(["makamujo-obs.service"]);
    expect(RECOVERY_SERVICES.xorgAndObs).toEqual([
      "makamujo-xvfb.service",
      "makamujo-obs.service",
    ]);
    expect(RECOVERY_SERVICES.browserAndBroadcastStack).toEqual([
      "makamujo-browser.service",
      "makamujo-xvfb.service",
      "makamujo-obs.service",
    ]);
  });
});

describe("restartServices", () => {
  it("restarts every unit in order, settling between them", async () => {
    const restarted: string[] = [];
    const slept: number[] = [];

    await restartServices(
      ["a.service", "b.service", "c.service"],
      async (service) => {
        restarted.push(service);
      },
      3_000,
      async (ms) => {
        slept.push(ms);
      },
    );

    expect(restarted).toEqual(["a.service", "b.service", "c.service"]);
    // 最後の unit の後は待たない。
    expect(slept).toEqual([3_000, 3_000]);
  });

  it("keeps going past a failing unit and reports the failures together", async () => {
    const restarted: string[] = [];

    const failure = restartServices(
      ["missing.service", "makamujo-obs.service"],
      async (service) => {
        restarted.push(service);
        if (service === "missing.service") {
          throw new Error(`systemctl restart ${service} failed`);
        }
      },
      0,
      async () => {},
    );

    // 途中の失敗で残りの unit を諦めると、古い unit 名ひとつでラングが
    // 何もしなくなる。失敗しても次の unit は試す。
    await expect(failure).rejects.toThrow("missing.service");
    expect(restarted).toEqual(["missing.service", "makamujo-obs.service"]);
  });

  it("resolves when every unit restarts", async () => {
    await expect(
      restartServices(
        ["makamujo-obs.service"],
        async () => {},
        0,
        async () => {},
      ),
    ).resolves.toBeUndefined();
  });
});
