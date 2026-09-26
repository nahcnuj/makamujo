import { describe, expect, it } from "bun:test";
import {
  fetchWatchPageProgram,
  startNiconamaWatchPagePoller,
} from "./niconamaWatchPagePoller";

const livePage = (): string => {
  const json = JSON.stringify({
    program: {
      nicoliveProgramId: "lv351439452",
      title: "テスト配信",
      watchPageUrl: "https://live.nicovideo.jp/watch/lv351439452",
      beginTime: 1_700_000_000,
      status: "ON_AIR",
      statistics: { watchCount: 12, commentCount: 34 },
    },
  });
  return `<script id="embedded-data" data-props="${json.replaceAll('"', "&quot;")}"></script>`;
};

const stubFetch = (body: string, status = 200): typeof fetch =>
  (() =>
    Promise.resolve(new Response(body, { status }))) as unknown as typeof fetch;

describe("fetchWatchPageProgram", () => {
  it("returns the program embedded in the page", async () => {
    const program = await fetchWatchPageProgram(
      "https://live.nicovideo.jp/watch/user/1",
      stubFetch(livePage()),
    );

    expect(program?.listeners).toBe(12);
    expect(program?.comments).toBe(34);
    expect(program?.isLive).toBe(true);
  });

  it("returns undefined for a page without a program", async () => {
    const program = await fetchWatchPageProgram(
      "https://live.nicovideo.jp/watch/user/1",
      stubFetch("<html><body>404</body></html>", 404),
    );

    expect(program).toBeUndefined();
  });

  it("propagates transport failures so callers can keep the previous state", async () => {
    const failing = (() =>
      Promise.reject(new Error("network down"))) as unknown as typeof fetch;

    await expect(
      fetchWatchPageProgram("https://live.nicovideo.jp/watch/user/1", failing),
    ).rejects.toThrow("network down");
  });
});

describe("startNiconamaWatchPagePoller", () => {
  it("reports the program on an explicit poll", async () => {
    const seen: unknown[] = [];
    const poller = startNiconamaWatchPagePoller({
      watchPageUrl: "https://live.nicovideo.jp/watch/user/1",
      intervalMs: 60_000,
      fetchImpl: stubFetch(livePage()),
      onProgram: (program) => seen.push(program),
    });

    await poller.pollOnce();
    poller.stop();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ listeners: 12, comments: 34 });
  });

  it("routes failures to onError and does not emit a program", async () => {
    const seen: unknown[] = [];
    const errors: unknown[] = [];
    const poller = startNiconamaWatchPagePoller({
      watchPageUrl: "https://live.nicovideo.jp/watch/user/1",
      intervalMs: 60_000,
      fetchImpl: (() =>
        Promise.reject(new Error("boom"))) as unknown as typeof fetch,
      onProgram: (program) => seen.push(program),
      onError: (error) => errors.push(error),
    });

    await poller.pollOnce();
    poller.stop();

    expect(seen).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("stops polling after stop()", async () => {
    let requestCount = 0;
    const countingFetch = (() => {
      requestCount += 1;
      return Promise.resolve(new Response(livePage(), { status: 200 }));
    }) as unknown as typeof fetch;

    const poller = startNiconamaWatchPagePoller({
      watchPageUrl: "https://live.nicovideo.jp/watch/user/1",
      intervalMs: 5,
      fetchImpl: countingFetch,
      onProgram: () => {},
    });

    await Bun.sleep(30);
    poller.stop();
    const countAtStop = requestCount;
    await Bun.sleep(30);

    expect(requestCount).toBe(countAtStop);
  });
});
