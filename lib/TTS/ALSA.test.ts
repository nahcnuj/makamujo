import { describe, expect, it } from "bun:test";
import { describePlayerFailure } from "./ALSA";

describe("describePlayerFailure", () => {
  it("keeps the player's own stderr and the exit code on one line", () => {
    const failure = describePlayerFailure({
      code: 1,
      stderr:
        "Connection failure: Connection refused\npa_context_connect() failed\n",
    });

    expect(failure).toBe("exit 1: Connection failure: Connection refused");
  });

  it("decodes buffered stderr", () => {
    const failure = describePlayerFailure({
      code: 1,
      stderr: new TextEncoder().encode("aplay: main:850: audio open error\n"),
    });

    expect(failure).toBe("exit 1: aplay: main:850: audio open error");
  });

  it("falls back when there is no stderr, and keeps the exit code", () => {
    expect(describePlayerFailure({ code: 1 })).toBe("exit 1");
    expect(describePlayerFailure({ stderr: "\n  \n" })).toBe("unknown error");
    expect(describePlayerFailure({ code: 2, stderr: "boom" })).toBe(
      "exit 2: boom",
    );
  });

  it("handles non-object rejections", () => {
    expect(describePlayerFailure("spawn paplay ENOENT")).toBe(
      "spawn paplay ENOENT",
    );
    expect(describePlayerFailure(undefined)).toBe("undefined");
  });
});
