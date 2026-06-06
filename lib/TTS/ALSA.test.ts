import { describe, expect, it, mock } from "bun:test";

// Variables named with "mock" prefix are accessible inside mock.module factory closures
// after hoisting (following the same convention used elsewhere in this test suite).
const mockAlsaError = new Error("aplay: device or resource busy");

mock.module("node:child_process", () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    cb: (err: Error | null) => void,
  ) => {
    cb(mockAlsaError);
  },
}));

const { play } = await import("./ALSA");

describe("ALSA play", () => {
  it("rejects when aplay exits with an error", async () => {
    await expect(play("/tmp/test.wav")).rejects.toThrow(mockAlsaError.message);
  });
});
