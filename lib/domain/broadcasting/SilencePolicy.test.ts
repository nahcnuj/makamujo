import { describe, expect, it } from "bun:test";
import {
  evaluateSpeechable,
  isCommentsStale,
  shouldPromptCommentAfterViewerIncrease,
} from "./SilencePolicy";

const thresholdMs = 5 * 60 * 1_000;

describe("evaluateSpeechable", () => {
  it("is true when not live and browser idle", () => {
    expect(
      evaluateSpeechable({
        streamLive: false,
        lastCommentAt: undefined,
        listenersStaleSince: undefined,
        hasPromptedCommentForViewerIncrease: false,
        browserStateName: undefined,
        nowMs: 1_000_000,
        thresholdMs,
      }),
    ).toBe(true);
  });

  it("returns false when prompted and comments stale even if listeners are fresh", () => {
    const nowMs = 1_000_000;
    expect(
      evaluateSpeechable({
        streamLive: true,
        lastCommentAt: new Date(nowMs - thresholdMs - 1),
        listenersStaleSince: new Date(nowMs), // fresh
        hasPromptedCommentForViewerIncrease: true,
        browserStateName: "idle",
        nowMs,
        thresholdMs,
      }),
    ).toBe(false);
  });

  it("returns false when both listeners and comments are stale", () => {
    const nowMs = 1_000_000;
    expect(
      evaluateSpeechable({
        streamLive: true,
        lastCommentAt: new Date(nowMs - thresholdMs - 1),
        listenersStaleSince: new Date(nowMs - thresholdMs - 1),
        hasPromptedCommentForViewerIncrease: false,
        browserStateName: "idle",
        nowMs,
        thresholdMs,
      }),
    ).toBe(false);
  });

  it("returns false when browser is not speechable even if silence clocks are fine", () => {
    const nowMs = 1_000_000;
    expect(
      evaluateSpeechable({
        streamLive: true,
        lastCommentAt: new Date(nowMs),
        listenersStaleSince: new Date(nowMs),
        hasPromptedCommentForViewerIncrease: false,
        browserStateName: "loading",
        nowMs,
        thresholdMs,
      }),
    ).toBe(false);
  });
});

describe("shouldPromptCommentAfterViewerIncrease", () => {
  it("requires prior comments, stale comments, and not yet prompted", () => {
    expect(
      shouldPromptCommentAfterViewerIncrease({
        hadCommentBefore: true,
        commentsStale: true,
        hasPromptedCommentForViewerIncrease: false,
      }),
    ).toBe(true);
    expect(
      shouldPromptCommentAfterViewerIncrease({
        hadCommentBefore: false,
        commentsStale: true,
        hasPromptedCommentForViewerIncrease: false,
      }),
    ).toBe(false);
    expect(
      shouldPromptCommentAfterViewerIncrease({
        hadCommentBefore: true,
        commentsStale: true,
        hasPromptedCommentForViewerIncrease: true,
      }),
    ).toBe(false);
  });
});

describe("isCommentsStale", () => {
  it("is stale when never commented", () => {
    expect(isCommentsStale(undefined, 100, thresholdMs)).toBe(true);
  });
});
