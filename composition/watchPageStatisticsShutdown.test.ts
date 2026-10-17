import { describe, expect, it } from "bun:test";
import { stopWatchPageStatisticsSource } from "./watchPageStatisticsShutdown";
import type { WatchPageStatisticsSource } from "./watchPageStatisticsSource";

const createSource = (
  stop: () => Promise<void>,
): WatchPageStatisticsSource => ({
  ready: Promise.resolve(),
  readOnce: async () => {},
  stop,
});

describe("stopWatchPageStatisticsSource", () => {
  it("stops the source", async () => {
    let stops = 0;
    await stopWatchPageStatisticsSource(
      createSource(async () => {
        stops += 1;
      }),
    );

    expect(stops).toBe(1);
  });

  it("does nothing without a source", async () => {
    await stopWatchPageStatisticsSource(undefined);
  });

  it("swallows a failure to stop", async () => {
    await stopWatchPageStatisticsSource(
      createSource(async () => {
        throw new Error("close failed");
      }),
    );
  });

  it("gives up on a browser that never finishes closing", async () => {
    const startedAt = Date.now();
    await stopWatchPageStatisticsSource(
      createSource(() => new Promise<void>(() => {})),
      20,
    );

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
