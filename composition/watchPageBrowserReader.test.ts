import { describe, expect, it } from "bun:test";
import {
  startWatchPageBrowserReader,
  toWatchPageSnapshot,
  type WatchPageSession,
  type WatchPageSnapshot,
} from "./watchPageBrowserReader";

const embeddedData = JSON.stringify({
  program: {
    nicoliveProgramId: "lv351439452",
    title: "テスト配信",
    watchPageUrl: "https://live.nicovideo.jp/watch/lv351439452",
    beginTime: 1_700_000_000,
    status: "ON_AIR",
  },
});

const liveSnapshot: WatchPageSnapshot = {
  program: {
    nicoliveProgramId: "lv351439452",
    title: "テスト配信",
    url: "https://live.nicovideo.jp/watch/lv351439452",
    isLive: true,
    startTime: 1_700_000_000,
  },
  statistics: { viewers: 25, comments: 1055, nicoadPoints: 30, giftPoints: 40 },
};

const createFakeSession = (
  snapshots: WatchPageSnapshot[],
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
      return (
        snapshots[Math.min(calls.reads - 1, snapshots.length - 1)] ??
        liveSnapshot
      );
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

describe("toWatchPageSnapshot", () => {
  it("turns the displayed text into numbers and reads the program identity", () => {
    expect(
      toWatchPageSnapshot({
        statistics: {
          viewers: "25",
          comments: "1,055",
          nicoadPoints: "30",
          giftPoints: "40",
        },
        embeddedData,
      }),
    ).toEqual(liveSnapshot);
  });

  it("drops metrics the page shows as a placeholder", () => {
    const snapshot = toWatchPageSnapshot({
      statistics: {
        viewers: "25",
        comments: "-",
        nicoadPoints: "-",
        giftPoints: "-",
      },
      embeddedData,
    });

    expect(snapshot.statistics).toEqual({ viewers: 25 });
  });

  it("reports no program when the page carries no embedded data", () => {
    const snapshot = toWatchPageSnapshot({
      statistics: {
        viewers: "-",
        comments: "-",
        nicoadPoints: "-",
        giftPoints: "-",
      },
      embeddedData: null,
    });

    expect(snapshot.program).toBeUndefined();
    expect(snapshot.statistics).toEqual({});
  });
});

describe("startWatchPageBrowserReader", () => {
  it("opens the page once and keeps reading the same session", async () => {
    const fake = createFakeSession([liveSnapshot]);
    const seen: WatchPageSnapshot[] = [];
    const reader = startWatchPageBrowserReader({
      watchPageUrl: "https://live.nicovideo.jp/watch/user/1",
      intervalMs: 60_000,
      createSession: fake.create,
      onSnapshot: (snapshot) => seen.push(snapshot),
    });

    await reader.readOnce();
    await reader.readOnce();
    await reader.stop();

    expect(fake.calls.created).toBe(1);
    expect(fake.calls.opened).toBe(1);
    expect(fake.calls.reads).toBe(2);
    expect(seen).toHaveLength(2);
  });

  it("keeps the previous snapshot and rebuilds the session after a failure", async () => {
    const fake = createFakeSession([liveSnapshot], { failOnReadAt: 1 });
    const seen: WatchPageSnapshot[] = [];
    const errors: unknown[] = [];
    const reader = startWatchPageBrowserReader({
      watchPageUrl: "https://live.nicovideo.jp/watch/user/1",
      intervalMs: 60_000,
      createSession: fake.create,
      onSnapshot: (snapshot) => seen.push(snapshot),
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
    const seen: WatchPageSnapshot[] = [];
    const reader = startWatchPageBrowserReader({
      watchPageUrl: "https://live.nicovideo.jp/watch/user/1",
      intervalMs: 60_000,
      createSession: () => Promise.reject(new Error("no browser")),
      onSnapshot: (snapshot) => seen.push(snapshot),
      onError: (error) => errors.push(error),
    });

    await reader.readOnce();
    await reader.stop();

    expect(errors).toHaveLength(1);
    expect(seen).toHaveLength(0);
  });

  it("stops reading after stop()", async () => {
    const fake = createFakeSession([liveSnapshot]);
    const reader = startWatchPageBrowserReader({
      watchPageUrl: "https://live.nicovideo.jp/watch/user/1",
      intervalMs: 5,
      createSession: fake.create,
      onSnapshot: () => {},
    });

    await Bun.sleep(30);
    await reader.stop();
    const readsAtStop = fake.calls.reads;
    await Bun.sleep(30);

    expect(fake.calls.reads).toBe(readsAtStop);
    expect(fake.calls.closed).toBe(1);
  });
});
