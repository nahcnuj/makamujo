import { describe, expect, it } from "bun:test";
import {
  drainSseDataPayloads,
  extractCompleteSseFrames,
  extractSseDataPayload,
  findSseBoundary,
} from "./sseFrames";

describe("findSseBoundary", () => {
  it("finds LF and CRLF boundaries", () => {
    // "data: a" is 7 chars; boundary starts at index of first \n of \n\n
    expect(findSseBoundary("data: a\n\nrest")).toEqual({ end: 7, length: 2 });
    expect(findSseBoundary("data: a\r\n\r\nrest")).toEqual({
      end: 7,
      length: 4,
    });
  });

  it("prefers the earlier boundary when both exist", () => {
    expect(findSseBoundary("x\n\ny\r\n\r\n")).toEqual({ end: 1, length: 2 });
  });

  it("returns null when incomplete", () => {
    expect(findSseBoundary("data: PARTIAL")).toBeNull();
    expect(findSseBoundary("data: a\n")).toBeNull();
  });
});

describe("extractCompleteSseFrames", () => {
  it("emits complete frames and keeps incomplete tail", () => {
    const { frames, rest } = extractCompleteSseFrames(
      "data: HELLO\n\ndata: PARTIAL",
    );
    expect(frames).toEqual(["data: HELLO\n\n"]);
    expect(rest).toBe("data: PARTIAL");
  });

  it("emits multiple frames", () => {
    const { frames, rest } = extractCompleteSseFrames("data: 1\n\ndata: 2\n\n");
    expect(frames).toHaveLength(2);
    expect(rest).toBe("");
  });
});

describe("extractSseDataPayload / drainSseDataPayloads", () => {
  it("joins multi-line data fields", () => {
    expect(extractSseDataPayload("data: a\ndata: b")).toBe("a\nb");
  });

  it("drains complete events for sink-style consumers", () => {
    const { payloads, rest } = drainSseDataPayloads(
      "data: HELLO\n\ndata: MORE",
    );
    expect(payloads).toEqual(["HELLO"]);
    expect(rest).toBe("data: MORE");
  });

  it("skips events without data lines", () => {
    const { payloads, rest } = drainSseDataPayloads(": comment\n\ndata: x\n\n");
    expect(payloads).toEqual(["x"]);
    expect(rest).toBe("");
  });
});
