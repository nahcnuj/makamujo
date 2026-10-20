import { describe, expect, it } from "bun:test";
import {
  type CompositeFreezeRecovery,
  type CompositeFreezeState,
  createCompositeFreezeState,
} from "../lib/domain/broadcasting/CompositeFreezePolicy";
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
  clockAdvancedSeconds: 3,
};

const still: PictureMotion = {
  comparedFrames: 60,
  changedFrames: 1,
  windowMs: 3_000,
  tainted: false,
  sawAdvertisement: false,
  clockAdvancedSeconds: 3,
};

/**
 * 番組終了の一枚絵: 合成出力も media clock も止まっている。放映外とみなされ、
 * 静止として数えない（`isOnAirFromClock` が false）。
 */
const offAirStill: PictureMotion = {
  ...still,
  clockAdvancedSeconds: 0,
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

  it("keeps climbing the ladder when a cycle could not be measured", async () => {
    const options = createWatcherOptions(
      [still, undefined, still, still, still],
      {
        intervalMs: 5,
        // 前プロセスが `obs` を打ち終えた直後の状態。cron の再起動で観測が
        // 1 周期飛んでも、ラングは `obs` に戻らない。
        stateStore: {
          load: () => ({
            stillCycles: 0,
            recoveryIndex: 1,
            lastRecoveryAtMs: Date.now() - 60_000,
          }),
          save: () => {},
        },
        config: { cyclesRequired: 3, recoveryCooldownMs: 0 },
      },
    );
    const watchdog = startBroadcastFreezeWatchdog(options);
    for (let tick = 0; tick < 6; tick++) {
      await waitTick();
    }
    watchdog.stop();

    expect(options.recoveries).toEqual(["xorgAndObs"]);
  });

  it("persists the policy state after every cycle", async () => {
    const saved: CompositeFreezeState[] = [];
    const options = createWatcherOptions([still, still], {
      intervalMs: 5,
      config: { cyclesRequired: 3, recoveryCooldownMs: 60_000 },
      stateStore: {
        load: () => createCompositeFreezeState(),
        save: (state) => saved.push(structuredClone(state)),
      },
    });
    const watchdog = startBroadcastFreezeWatchdog(options);
    await waitTick();
    await waitTick();
    watchdog.stop();

    // 静止が 2 周期分。以降の周期は測定が尽きて unknown になるが、ここでは
    // 保存されることだけを見ている。
    expect(saved.slice(0, 2)).toEqual([
      { stillCycles: 1, recoveryIndex: 0, lastRecoveryAtMs: undefined },
      { stillCycles: 2, recoveryIndex: 0, lastRecoveryAtMs: undefined },
    ]);
  });

  it("breaks the still streak at an off-air cycle without erasing the ladder", async () => {
    // 3 周期目だけ放映外（media clock が進まない一枚絵）。放映中かは測定した
    // `PictureMotion` の clock から導くので、台本は measurement で組む。
    const measurements = [still, still, offAirStill, still, still, still];
    const saved: CompositeFreezeState[] = [];
    const options = createWatcherOptions(measurements, {
      intervalMs: 5,
      stateStore: {
        load: () => createCompositeFreezeState(),
        save: (state) => saved.push(structuredClone(state)),
      },
      config: { cyclesRequired: 3, recoveryCooldownMs: 60_000 },
    });
    const watchdog = startBroadcastFreezeWatchdog(options);
    for (let tick = 0; tick < 6; tick++) {
      await waitTick();
    }
    watchdog.stop();

    // 放映外の周期は streak を断つ（番組終了後の一枚絵を静止として数えない）
    // が、ラングは消さない。静止は放映外のあとから数え直し、`obs` を 1 度だけ
    // 打って、クールダウンで次のラングは待つ。
    expect(options.recoveries).toEqual(["obs"]);
    expect(saved).toContainEqual({
      stillCycles: 0,
      recoveryIndex: 0,
      lastRecoveryAtMs: undefined,
    });
  });

  it("keeps the resumed ladder across the off-air startup tick", async () => {
    // サーバーは cron に 11 分ごとに殺され start される。起動直後の最初の tick
    // は配信ページの開設が間に合わず測定できない（clock も読めない）ため
    // `unknown` になる。ここで永続化された状態を消すと、ラングが毎回 `obs` に
    // 戻って deep な回復が一度も打てない（issue #927）。
    const measurements: (PictureMotion | undefined)[] = [
      undefined,
      still,
      still,
      still,
      still,
    ];
    const options = createWatcherOptions(measurements, {
      intervalMs: 5,
      // 前プロセスが `obs` を打ち終えた直後の状態を引き継いで起動した想定。
      stateStore: {
        load: () => ({
          stillCycles: 0,
          recoveryIndex: 1,
          lastRecoveryAtMs: undefined,
        }),
        save: () => {},
      },
      config: { cyclesRequired: 3, recoveryCooldownMs: 60_000 },
    });
    const watchdog = startBroadcastFreezeWatchdog(options);
    for (let tick = 0; tick < 6; tick++) {
      await waitTick();
    }
    watchdog.stop();

    // 起動直後の測定不能 tick を挟んでも、次に打たれるのは 2 番目のラング。
    expect(options.recoveries).toEqual(["xorgAndObs"]);
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

  it("logs a measurement that throws and keeps the watchdog alive", async () => {
    // tick の外へ例外を漏らすと Bun の unhandled rejection になり、以降の周期が
    // 静かに止まる。回復の機会が失われるので、失敗を記録して次の周期を続ける
    // （issue #931）。
    const errors: string[] = [];
    let calls = 0;
    const options = createWatcherOptions([], {
      measurePictureMotion: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("measurement exploded");
        }
        return moving;
      },
      intervalMs: 5,
      log: { ...silentLog, error: (...args) => errors.push(args.join(" ")) },
    });
    const watchdog = startBroadcastFreezeWatchdog(options);
    for (let tick = 0; tick < 4; tick++) {
      await waitTick();
    }
    watchdog.stop();

    expect(errors.some((line) => line.includes("measurement exploded"))).toBe(
      true,
    );
    // 最初の失敗で止まらず、以降の周期も測定している。
    expect(calls).toBeGreaterThan(1);
  });

  it("logs why a cycle was skipped without flooding the journal", async () => {
    // 外からの健康チェックだけが検知し続ける停止（issue #944）のあいだ、
    // watchdog は毎周期を見送っている。見送った理由が journal に残らないと、
    // 「回復がなぜ一度も走らなかったか」を後から辿れない。
    const warnings: string[] = [];
    const options = createWatcherOptions(new Array(12).fill(undefined), {
      intervalMs: 5,
      log: {
        ...silentLog,
        warn: (...args: unknown[]) => warnings.push(args.join(" ")),
      },
    });
    const watchdog = startBroadcastFreezeWatchdog(options);
    for (let tick = 0; tick < 12; tick++) {
      await waitTick();
    }
    watchdog.stop();

    const skipped = warnings.filter((line) => line.includes("skipping"));
    // 1 回目と 10 回ごとだけ。連続する見送りで journal を埋めない。
    const skippedCounts = skipped.map((line) =>
      Number(/#(\d+)/.exec(line)?.[1] ?? 0),
    );
    expect(skippedCounts.length).toBeGreaterThanOrEqual(2);
    expect(skippedCounts[0]).toBe(1);
    expect(skippedCounts[1]).toBe(10);
    expect(skippedCounts.slice(2).every((count) => count % 10 === 0)).toBe(
      true,
    );
    expect(skipped[0]).toContain("unmeasurable");
    expect(skipped[0]).toContain("recoveryIndex");
  });

  it("labels an off-air cycle when it skips", async () => {
    const warnings: string[] = [];
    const options = createWatcherOptions([offAirStill, moving], {
      intervalMs: 5,
      log: {
        ...silentLog,
        warn: (...args: unknown[]) => warnings.push(args.join(" ")),
      },
    });
    const watchdog = startBroadcastFreezeWatchdog(options);
    await waitTick();
    await waitTick();
    watchdog.stop();

    expect(warnings.some((line) => line.includes("off-air"))).toBe(true);
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
