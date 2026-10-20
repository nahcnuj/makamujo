import { describe, expect, it } from "bun:test";
import type { DisplayedStatistics } from "../lib/domain/broadcasting/watchPageStatistics";
import type { PictureMotion, WatchPageBrowser } from "./watchPageBrowser";
import {
  PICTURE_MOTION_PAGE_RECREATE_AFTER_FAILURES,
  startWatchPageStatisticsSource,
} from "./watchPageStatisticsSource";

const statistics = (
  overrides: DisplayedStatistics = {},
): DisplayedStatistics => ({
  viewers: 25,
  comments: 1_055,
  nicoadPoints: 123_000,
  giftPoints: 8,
  ...overrides,
});

/** 測定できた（`still` かどうかは watchdog の仕事なので問わない）。 */
const measured: PictureMotion = {
  comparedFrames: 60,
  changedFrames: 0,
  windowMs: 3_000,
  tainted: false,
  sawAdvertisement: false,
  clockAdvancedSeconds: 3,
};

const createStubBrowser = (
  readings: DisplayedStatistics[],
  {
    failOnReadAt,
    failOnOpenAt,
    isAlive = () => true,
    measurePictureMotion,
  }: {
    failOnReadAt?: number;
    failOnOpenAt?: number;
    isAlive?: () => boolean;
    measurePictureMotion?: () => Promise<PictureMotion>;
  } = {},
) => {
  const calls = { created: 0, opened: 0, reads: 0, discarded: 0 };
  const browser: WatchPageBrowser = {
    open: async (watchPageUrl) => {
      calls.opened += 1;
      void watchPageUrl;
      if (failOnOpenAt === calls.opened) {
        throw new Error("navigation failed");
      }
    },
    read: async () => {
      calls.reads += 1;
      if (failOnReadAt === calls.reads) {
        throw new Error("page closed");
      }
      return readings[Math.min(calls.reads - 1, readings.length - 1)] ?? {};
    },
    // 実体の生死だけを報告する。`open` に失敗した実体は source が破棄する。
    isAlive,
    discard: async () => {
      calls.discarded += 1;
    },
    ...(measurePictureMotion === undefined ? {} : { measurePictureMotion }),
  };
  return {
    calls,
    create: async (): Promise<WatchPageBrowser> => {
      calls.created += 1;
      return browser;
    },
  };
};

const silentLog = { log: () => {}, warn: () => {}, error: () => {} };

describe("startWatchPageStatisticsSource", () => {
  it("publishes the statistics read from the rendered page", async () => {
    const stub = createStubBrowser([statistics()]);
    const samples: DisplayedStatistics[] = [];

    const source = startWatchPageStatisticsSource({
      env: {},
      log: silentLog,
      createBrowser: stub.create,
      onStatistics: (read) => samples.push(read),
    });
    await source.ready;
    await source.stop();

    expect(samples).toEqual([
      { viewers: 25, comments: 1_055, nicoadPoints: 123_000, giftPoints: 8 },
    ]);
  });

  it("reads nothing at all when disabled", async () => {
    const stub = createStubBrowser([statistics()]);
    const samples: DisplayedStatistics[] = [];

    const source = startWatchPageStatisticsSource({
      env: { NICONAMA_WATCH_PAGE_DISABLED: "1" },
      log: silentLog,
      createBrowser: stub.create,
      onStatistics: (read) => samples.push(read),
    });
    await source.ready;

    expect(stub.calls.opened).toBe(0);
    expect(samples).toEqual([]);
  });

  it("publishes metrics the page shows as a placeholder as no value", async () => {
    const stub = createStubBrowser([
      statistics({
        viewers: undefined,
        comments: undefined,
        nicoadPoints: undefined,
        giftPoints: undefined,
      }),
    ]);
    const samples: DisplayedStatistics[] = [];

    const source = startWatchPageStatisticsSource({
      env: {},
      log: silentLog,
      createBrowser: stub.create,
      onStatistics: (read) => samples.push(read),
    });
    await source.ready;
    await source.stop();

    expect(samples).toEqual([
      {
        viewers: undefined,
        comments: undefined,
        nicoadPoints: undefined,
        giftPoints: undefined,
      },
    ]);
  });

  it("opens the page once and keeps reading the same browser", async () => {
    const stub = createStubBrowser([statistics()]);
    const source = startWatchPageStatisticsSource({
      env: {},
      log: silentLog,
      createBrowser: stub.create,
      onStatistics: () => {},
    });

    await source.ready;
    await source.readOnce();
    await source.readOnce();
    await source.stop();

    expect(stub.calls.created).toBe(1);
    expect(stub.calls.opened).toBe(1);
    expect(stub.calls.reads).toBe(3);
  });

  it("keeps a failed read out of the published statistics without reopening the page", async () => {
    const stub = createStubBrowser([statistics()], { failOnReadAt: 1 });
    const warnings: unknown[][] = [];
    const samples: DisplayedStatistics[] = [];

    const source = startWatchPageStatisticsSource({
      env: {},
      log: {
        log: () => {},
        warn: (...args: unknown[]) => warnings.push(args),
        error: () => {},
      },
      createBrowser: stub.create,
      onStatistics: (read) => samples.push(read),
    });
    await source.ready;
    await source.readOnce();
    await source.stop();

    expect(samples).toEqual([statistics()]);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain("failed to read");
    // 読み取りに失敗しても開いたままのページを捨てない。普通に視聴するとき
    // にブラウザを開いたり閉じたりしないのと同じ理屈。
    expect(stub.calls.created).toBe(1);
    expect(stub.calls.opened).toBe(1);
  });

  it("keeps reading the same open page across repeated failures", async () => {
    const stub = createStubBrowser([statistics()], { failOnReadAt: 2 });
    const warnings: unknown[][] = [];
    const samples: DisplayedStatistics[] = [];

    const source = startWatchPageStatisticsSource({
      env: {},
      log: {
        log: () => {},
        warn: (...args: unknown[]) => warnings.push(args),
        error: () => {},
      },
      createBrowser: stub.create,
      onStatistics: (read) => samples.push(read),
    });
    await source.ready;
    await source.readOnce();
    await source.readOnce();
    await source.stop();

    expect(samples).toEqual([statistics(), statistics()]);
    expect(warnings).toHaveLength(1);
    expect(stub.calls.created).toBe(1);
    expect(stub.calls.opened).toBe(1);
    expect(stub.calls.reads).toBe(3);
  });

  it("rebuilds the browser only after it reports that it died", async () => {
    let alive = true;
    const stub = createStubBrowser([statistics()], { isAlive: () => alive });
    const source = startWatchPageStatisticsSource({
      env: {},
      log: silentLog,
      createBrowser: stub.create,
      onStatistics: () => {},
    });

    await source.ready;
    expect(stub.calls.opened).toBe(1);

    alive = false;
    await source.readOnce();
    await source.stop();

    expect(stub.calls.created).toBe(2);
    expect(stub.calls.opened).toBe(2);
    expect(stub.calls.discarded).toBe(2);
  });

  it("reopens the page when the previous open did not finish", async () => {
    const stub = createStubBrowser([statistics()], { failOnOpenAt: 1 });
    const warnings: unknown[][] = [];
    const samples: DisplayedStatistics[] = [];

    const source = startWatchPageStatisticsSource({
      env: {},
      log: {
        log: () => {},
        warn: (...args: unknown[]) => warnings.push(args),
        error: () => {},
      },
      createBrowser: stub.create,
      onStatistics: (read) => samples.push(read),
    });
    await source.ready;
    await source.readOnce();
    await source.stop();

    // `open` に失敗したブラウザは source が破棄する。次の採取で作り直し、
    // ページを開き直す。
    expect(samples).toEqual([statistics()]);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[1])).toContain("navigation failed");
    expect(stub.calls.created).toBe(2);
    expect(stub.calls.opened).toBe(2);
    expect(stub.calls.discarded).toBe(2);
  });

  it("reports a browser that cannot be created without throwing", async () => {
    const warnings: unknown[][] = [];
    const samples: DisplayedStatistics[] = [];

    const source = startWatchPageStatisticsSource({
      env: {},
      log: {
        log: () => {},
        warn: (...args: unknown[]) => warnings.push(args),
        error: () => {},
      },
      createBrowser: () => Promise.reject(new Error("no browser")),
      onStatistics: (read) => samples.push(read),
    });
    await source.ready;
    await source.stop();

    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[1])).toContain("no browser");
    expect(samples).toEqual([]);
  });

  it("stops reading after stop()", async () => {
    const stub = createStubBrowser([statistics()]);
    const source = startWatchPageStatisticsSource({
      env: {},
      log: silentLog,
      readIntervalMs: 5,
      createBrowser: stub.create,
      onStatistics: () => {},
    });

    await source.ready;
    await Bun.sleep(30);
    await source.stop();
    const readsAtStop = stub.calls.reads;
    await Bun.sleep(30);

    expect(stub.calls.reads).toBe(readsAtStop);
    expect(stub.calls.discarded).toBe(1);
  });

  it("measures on the kept-open page without reopening it", async () => {
    const stub = createStubBrowser([statistics()], {
      measurePictureMotion: async () => measured,
    });
    const source = startWatchPageStatisticsSource({
      env: {},
      log: silentLog,
      createBrowser: stub.create,
      onStatistics: () => {},
    });

    await source.ready;
    await expect(source.measurePictureMotion()).resolves.toBe(measured);
    await expect(source.measurePictureMotion()).resolves.toBe(measured);
    await source.stop();

    // 測定のためにページを開き直さない。開いているのは統計の採取が開いた
    // それだけ。
    expect(stub.calls.created).toBe(1);
    expect(stub.calls.opened).toBe(1);
  });

  it("drops the page only after the measurement keeps failing", async () => {
    const stub = createStubBrowser([statistics()], {
      measurePictureMotion: async () => {
        throw new Error("no capturable video");
      },
    });
    const warnings: unknown[][] = [];
    const source = startWatchPageStatisticsSource({
      env: {},
      log: {
        log: () => {},
        warn: (...args: unknown[]) => warnings.push(args),
        error: () => {},
      },
      createBrowser: stub.create,
      onStatistics: () => {},
    });

    await source.ready;
    for (
      let attempt = 1;
      attempt < PICTURE_MOTION_PAGE_RECREATE_AFTER_FAILURES;
      attempt++
    ) {
      await expect(source.measurePictureMotion()).resolves.toBeUndefined();
      expect(stub.calls.discarded).toBe(0);
    }
    await expect(source.measurePictureMotion()).resolves.toBeUndefined();

    // 生きてはいるが測れないページは、配信画面の停止を測る側を塞ぐ
    // （外からの健康チェックは毎回新しいページで測り続ける）。連続する失敗が
    // 続いたら捨て、次の統計の採取に開き直させる。
    expect(stub.calls.discarded).toBe(1);
    expect(String(warnings.at(-1)?.[0])).toContain("dropping the watch page");

    // 測定そのものは開き直さない。開き直すのは統計の採取。
    await expect(source.measurePictureMotion()).resolves.toBeUndefined();
    expect(stub.calls.created).toBe(1);

    await source.readOnce();
    expect(stub.calls.created).toBe(2);
    expect(stub.calls.opened).toBe(2);
    await source.stop();
  });

  it("counts an implementation that cannot measure as unmeasurable", async () => {
    // `measurePictureMotion` を持たない差し替え実装（古い実装 / 測れない環境）。
    const stub = createStubBrowser([statistics()]);
    const source = startWatchPageStatisticsSource({
      env: {},
      log: silentLog,
      createBrowser: stub.create,
      onStatistics: () => {},
    });

    await source.ready;
    for (
      let attempt = 0;
      attempt < PICTURE_MOTION_PAGE_RECREATE_AFTER_FAILURES;
      attempt++
    ) {
      await expect(source.measurePictureMotion()).resolves.toBeUndefined();
    }

    expect(stub.calls.discarded).toBe(1);
    await source.stop();
  });

  it("keeps the page while measurements keep succeeding", async () => {
    let attempts = 0;
    const stub = createStubBrowser([statistics()], {
      measurePictureMotion: async () => {
        attempts += 1;
        // 失敗と成功が混ざる周期でも、成功すれば連続失敗は数えない。
        if (attempts % 2 === 0) {
          return measured;
        }
        throw new Error("navigation gap");
      },
    });
    const source = startWatchPageStatisticsSource({
      env: {},
      log: silentLog,
      createBrowser: stub.create,
      onStatistics: () => {},
    });

    await source.ready;
    await source.measurePictureMotion(); // 失敗 1
    await source.measurePictureMotion(); // 成功（連続失敗をリセット）
    await source.measurePictureMotion(); // 失敗 1
    await source.measurePictureMotion(); // 成功
    await source.measurePictureMotion(); // 失敗 1
    await source.measurePictureMotion(); // 成功
    expect(stub.calls.discarded).toBe(0);
    await source.stop();

    expect(stub.calls.created).toBe(1);
  });

  it("does not drop a page while stopped", async () => {
    const stub = createStubBrowser([statistics()], {
      measurePictureMotion: async () => {
        throw new Error("no capturable video");
      },
    });
    const source = startWatchPageStatisticsSource({
      env: {},
      log: silentLog,
      createBrowser: stub.create,
      onStatistics: () => {},
    });

    await source.ready;
    await source.stop();
    const discardedAtStop = stub.calls.discarded;
    for (
      let attempt = 0;
      attempt < PICTURE_MOTION_PAGE_RECREATE_AFTER_FAILURES;
      attempt++
    ) {
      await expect(source.measurePictureMotion()).resolves.toBeUndefined();
    }

    expect(stub.calls.discarded).toBe(discardedAtStop);
  });
});
