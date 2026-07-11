import { describe, expect, it, mock } from "bun:test";

const mockAlsaError = new Error("aplay: device or resource busy");

mock.module("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const maybeCb = args[args.length - 1];
    if (typeof maybeCb === "function") {
      (maybeCb as (err: Error | null) => void)(mockAlsaError);
    }
  },
}));

const { play } = await import("./ALSA");

describe("ALSA play", () => {
  it("rejects when aplay exits with an error", async () => {
    await expect(play("/tmp/test.wav")).rejects.toThrow(mockAlsaError.message);
  });
});
