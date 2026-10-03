import { describe, expect, it } from "bun:test";
import type { DisplayedStatistics } from "../lib/domain/broadcasting/watchPageStatistics";
import {
  isWatchPageReadable,
  startWatchPageBrowserReader,
  toDisplayedStatistics,
  type WatchPageRawReading,
  type WatchPageSession,
} from "./watchPageBrowserReader";

const liveStatistics: DisplayedStatistics = {
  viewers: 25,
  comments: 1055,
  nicoadPoints: 30,
  giftPoints: 40,
};

const createFakeSession = (
  readings: DisplayedStatistics[],
  options: { failOnReadAt?: number } = {},
) => {
  const calls = { created: 0, opened: 0, reads: 0, closed: 0 };
  const session: WatchPageSession = {
    open: async () => {
      calls.opened += 1;
    },
    read: async () => {
      calls.reads += 1;
      if (options.failOnReadAt === calls.reads) {
        throw new Error("page closed");
      }
      return readings[Math.min(calls.reads - 1, readings.length - 1)] ?? {};
    },
    close: async () => {
      calls.closed += 1;
    },
  };
  return {
    calls,
    create: async (): Promise<WatchPageSession> => {
      calls.created += 1;
      return session;
    },
  };
};

describe("toDisplayedStatistics", () => {
  it("turns the displayed text into numbers", () => {
    expect(
      toDisplayedStatistics({
        statistics: {
          viewers: "25",
          comments: "1,055",
          nicoadPoints: "30",
          giftPoints: "40",
        },
        hasStatisticsRow: true,
      }),
    ).toEqual(liveStatistics);
  });

  it("keeps metrics the page shows as a placeholder as no value", () => {
    expect(
      toDisplayedStatistics({
        statistics: {
          viewers: "25",
          comments: "-",
          nicoadPoints: "-",
          giftPoints: "-",
        },
        hasStatisticsRow: true,
      }),
    ).toEqual({
      viewers: 25,
      comments: undefined,
      nicoadPoints: undefined,
      giftPoints: undefined,
    });
  });
});

describe("isWatchPageReadable", () => {
  it("accepts a page that shows the statistics row even with placeholders", () => {
    expect(
      isWatchPageReadable({
        statistics: {
          viewers: "-",
          comments: "-",
          nicoadPoints: "-",
          giftPoints: "-",
        },
        hasStatisticsRow: true,
      }),
    ).toBe(true);
  });

  it("rejects a page without the statistics row", () => {
    const raw: WatchPageRawReading = {
      statistics: {
        viewers: null,
        comments: null,
        nicoadPoints: null,
        giftPoints: null,
      },
      hasStatisticsRow: false,
    };

    expect(isWatchPageReadable(raw)).toBe(false);
  });
});

describe("startWatchPageBrowserReader", () => {
  it("opens the page once and keeps reading the same session", async () => {
    const fake = createFakeSession([liveStatistics]);
    const seen: DisplayedStatistics[] = [];
    const reader = startWatchPageBrowserReader({
      watchPageUrl: "https://live.nicovideo.jp/watch/user/1",
      intervalMs: 60_000,
      createSession: fake.create,
      onStatistics: (statistics) => seen.push(statistics),
    });

    await reader.readOnce();
    await reader.readOnce();
    await reader.stop();

    expect(fake.calls.created).toBe(1);
    expect(fake.calls.opened).toBe(1);
    expect(fake.calls.reads).toBe(2);
    expect(seen).toEqual([liveStatistics, liveStatistics]);
  });

  it("keeps the previous statistics and rebuilds the session after a failure", async () => {
    const fake = createFakeSession([liveStatistics], { failOnReadAt: 1 });
    const seen: DisplayedStatistics[] = [];
    const errors: unknown[] = [];
    const reader = startWatchPageBrowserReader({
      watchPageUrl: "https://live.nicovideo.jp/watch/user/1",
      intervalMs: 60_000,
      createSession: fake.create,
      onStatistics: (statistics) => seen.push(statistics),
      onError: (error) => errors.push(error),
    });

    await reader.readOnce();
    await reader.readOnce();
    await reader.stop();

    expect(errors).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(fake.calls.created).toBe(2);
    // 失敗したセッションと、stop() 時に閉じた 2 つ目を数えている。
    expect(fake.calls.closed).toBe(2);
  });

  it("reports a session that cannot be created without throwing", async () => {
    const errors: unknown[] = [];
    const seen: DisplayedStatistics[] = [];
    const reader = startWatchPageBrowserReader({
      watchPageUrl: "https://live.nicovideo.jp/watch/user/1",
      intervalMs: 60_000,
      createSession: () => Promise.reject(new Error("no browser")),
      onStatistics: (statistics) => seen.push(statistics),
      onError: (error) => errors.push(error),
    });

    await reader.readOnce();
    await reader.stop();

    expect(errors).toHaveLength(1);
    expect(seen).toHaveLength(0);
  });

  it("stops reading after stop()", async () => {
    const fake = createFakeSession([liveStatistics]);
    const reader = startWatchPageBrowserReader({
      watchPageUrl: "https://live.nicovideo.jp/watch/user/1",
      intervalMs: 5,
      createSession: fake.create,
      onStatistics: () => {},
    });

    await Bun.sleep(30);
    await reader.stop();
    const readsAtStop = fake.calls.reads;
    await Bun.sleep(30);

    expect(fake.calls.reads).toBe(readsAtStop);
    expect(fake.calls.closed).toBe(1);
  });
});
