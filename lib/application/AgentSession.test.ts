import { describe, expect, test } from "bun:test";
import { AgentSession } from "./AgentSession";

describe("AgentSession stream baseline", () => {
  test("exposes the default baseline before any activity", () => {
    const session = new AgentSession();
    expect(session.toStreamBaseline()).toEqual({
      previousStreamCommentCount: 0,
      currentProgramUrl: undefined,
      currentProgramLatestCommentNo: 0,
    });
  });

  test("restoreStreamBaseline seeds comment tracking fields", () => {
    const session = new AgentSession();
    session.restoreStreamBaseline({
      previousStreamCommentCount: 538,
      currentProgramUrl: "https://live.example/watch/lv1",
      currentProgramLatestCommentNo: 540,
    });

    expect(session.previousStreamCommentCount).toBe(538);
    expect(session.currentProgramUrl).toBe("https://live.example/watch/lv1");
    expect(session.currentProgramLatestCommentNo).toBe(540);
    expect(session.toStreamBaseline()).toEqual({
      previousStreamCommentCount: 538,
      currentProgramUrl: "https://live.example/watch/lv1",
      currentProgramLatestCommentNo: 540,
    });
  });

  test("clearing the program url is reflected by the baseline", () => {
    const session = new AgentSession();
    session.restoreStreamBaseline({
      previousStreamCommentCount: 1,
      currentProgramUrl: "https://live.example/watch/lv1",
      currentProgramLatestCommentNo: 2,
    });
    session.currentProgramUrl = undefined;

    expect(session.toStreamBaseline().currentProgramUrl).toBeUndefined();
  });

  test("restores lastCommentAt from a Date", () => {
    const session = new AgentSession();
    const when = new Date(1_700_000_000_000);
    session.restoreStreamBaseline({
      previousStreamCommentCount: 0,
      currentProgramLatestCommentNo: 0,
      lastCommentAt: when,
    });

    expect(session.lastCommentAt).toEqual(when);
    expect(session.toStreamBaseline().lastCommentAt).toEqual(when);
  });

  test("restores lastCommentAt from an ISO string", () => {
    const session = new AgentSession();
    const when = new Date(1_700_000_000_000);
    session.restoreStreamBaseline({
      previousStreamCommentCount: 0,
      currentProgramLatestCommentNo: 0,
      lastCommentAt: when.toISOString() as unknown as Date,
    });

    expect(session.lastCommentAt).toEqual(when);
  });
});
