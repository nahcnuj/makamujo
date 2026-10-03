import { describe, expect, it } from "bun:test";
import type { DisplayedStatistics } from "../lib/domain/broadcasting/watchPageStatistics";
import type { WatchPageSession } from "./watchPageBrowserReader";
import { startWatchPageStatisticsSource } from "./watchPageStatisticsSource";

const statistics = (
  overrides: DisplayedStatistics = {},
): DisplayedStatistics => ({
  viewers: 25,
  comments: 1_055,
  nicoadPoints: 123_000,
  giftPoints: 8,
  ...overrides,
});

const createStubSession = (readings: DisplayedStatistics[]) => {
  let index = 0;
  const opened: string[] = [];
  let closed = 0;
  const session: WatchPageSession = {
    open: async (watchPageUrl) => {
      opened.push(watchPageUrl);
    },
    read: async () => {
      const next = readings[Math.min(index, readings.length - 1)];
      index += 1;
      if (next === undefined) {
        throw new Error("no reading");
      }
      return next;
    },
    close: async () => {
      closed += 1;
    },
  };
  return { session, opened, closedCount: () => closed };
};

const silentLog = { log: () => {}, warn: () => {}, error: () => {} };

describe("startWatchPageStatisticsSource", () => {
  it("publishes the statistics read from the rendered page", async () => {
    const stub = createStubSession([statistics()]);
    const samples: DisplayedStatistics[] = [];

    const source = startWatchPageStatisticsSource({
      env: {},
      log: silentLog,
      createSession: async () => stub.session,
      onStatistics: (read) => samples.push(read),
    });
    await source.ready;
    await source.stop();

    expect(stub.opened).toEqual([
      "https://live.nicovideo.jp/watch/user/14171889",
    ]);
    expect(samples).toEqual([
      { viewers: 25, comments: 1_055, nicoadPoints: 123_000, giftPoints: 8 },
    ]);
  });

  it("reads nothing at all when disabled", async () => {
    const stub = createStubSession([statistics()]);
    const samples: DisplayedStatistics[] = [];

    const source = startWatchPageStatisticsSource({
      env: { NICONAMA_WATCH_PAGE_DISABLED: "1" },
      log: silentLog,
      createSession: async () => stub.session,
      onStatistics: (read) => samples.push(read),
    });
    await source.ready;

    expect(stub.opened).toEqual([]);
    expect(samples).toEqual([]);
  });

  it("publishes metrics the page shows as a placeholder as no value", async () => {
    const stub = createStubSession([
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
      createSession: async () => stub.session,
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

  it("keeps a failed read out of the published statistics", async () => {
    const warnings: unknown[][] = [];
    const samples: DisplayedStatistics[] = [];

    const source = startWatchPageStatisticsSource({
      env: {},
      log: {
        log: () => {},
        warn: (...args: unknown[]) => warnings.push(args),
        error: () => {},
      },
      createSession: async () => ({
        open: async () => {},
        read: async () => {
          throw new Error("navigation failed");
        },
        close: async () => {},
      }),
      onStatistics: (read) => samples.push(read),
    });
    await source.ready;
    await source.stop();

    expect(samples).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain("failed to read");
  });

  it("closes the session it created on stop", async () => {
    const stub = createStubSession([statistics()]);

    const source = startWatchPageStatisticsSource({
      env: {},
      log: silentLog,
      createSession: async () => stub.session,
      onStatistics: () => {},
    });
    await source.ready;
    await source.stop();

    expect(stub.closedCount()).toBeGreaterThan(0);
  });
});
