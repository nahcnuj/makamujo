import { describe, expect, it } from "bun:test";
import {
  assemblePublishedPayload,
  attachReplyTargetToPublished,
  extractMetaPostBody,
} from "./assemblePublishedPayload";

const streamer = {
  canSpeak: true,
  currentGame: { name: "CookieClicker" },
  currentNGramSize: 2,
  currentNGramSizeRaw: 2.1,
  commentCount: 99,
};

describe("assemblePublishedPayload", () => {
  it("uses agent stream when lastPublished is null", () => {
    const payload = assemblePublishedPayload({
      lastPublished: null,
      agentStreamState: {
        type: "live",
        meta: { title: "t", url: "u", start: 1, total: { listeners: 3, gift: 0, ad: 0, comments: 5 } },
      },
      streamer,
      speechState: { speech: "hi", silent: false },
      history: [{ id: "1", speech: "a" }],
    });

    expect(payload.niconama).toEqual({
      type: "live",
      meta: { title: "t", url: "u", start: 1, total: { listeners: 3, gift: 0, ad: 0, comments: 5 } },
    });
    expect(payload.canSpeak).toBe(true);
    expect(payload.nGram).toBe(2);
    expect(payload.speech).toEqual({ speech: "hi", silent: false });
    expect(payload.commentCount).toBe(99);
  });

  it("does not merge agent niconama when lastPublished is set; replyTarget falls back to agent", () => {
    const lastPublished = {
      type: "niconama",
      data: {
        title: "published-title",
        isLive: true,
        startTime: 10,
        total: 1,
        points: { gift: 0, ad: 0 },
        url: "https://published.example",
      },
    };
    const agentStreamState = {
      type: "live",
      meta: { title: "agent-only", url: "https://agent.example", start: 99 },
      replyTargetComment: { text: "返信", pickedTopic: "返" },
    };

    const payload = assemblePublishedPayload({
      lastPublished,
      agentStreamState,
      streamer,
      speechState: { speech: "", silent: false },
      history: [],
    });

    expect((payload.niconama as { meta?: { title?: string } }).meta?.title).toBe("published-title");
    expect((payload.niconama as { meta?: { title?: string } }).meta?.title).not.toBe("agent-only");
    expect(payload.replyTargetComment).toEqual({ text: "返信", pickedTopic: "返" });
  });

  it("prefers base replyTarget over agent when both exist", () => {
    const payload = assemblePublishedPayload({
      lastPublished: {
        niconama: { type: "live" },
        replyTargetComment: { text: "from-base", pickedTopic: "b" },
      },
      agentStreamState: {
        niconama: { type: "live" },
        replyTargetComment: { text: "from-agent", pickedTopic: "a" },
      },
      streamer,
      speechState: {},
      history: [],
    });
    expect(payload.replyTargetComment).toEqual({ text: "from-base", pickedTopic: "b" });
  });

  it("slices speechHistory to SSE size", () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ id: String(i) }));
    const payload = assemblePublishedPayload({
      lastPublished: null,
      agentStreamState: null,
      streamer,
      speechState: {},
      history,
      historySseSize: 20,
    });
    expect(payload.speechHistory).toHaveLength(20);
  });
});

describe("extractMetaPostBody", () => {
  it("unwraps data when type is absent", () => {
    const { published, replyTargetComment } = extractMetaPostBody({
      data: { niconama: { type: "live" }, replyTargetComment: { text: "x", pickedTopic: "y" } },
    });
    expect(published).toEqual({
      niconama: { type: "live" },
      replyTargetComment: { text: "x", pickedTopic: "y" },
    });
    expect(replyTargetComment).toEqual({ text: "x", pickedTopic: "y" });
  });

  it("reads replyTarget from top-level body", () => {
    const { replyTargetComment } = extractMetaPostBody({
      type: "niconama",
      data: {},
      replyTargetComment: { text: "top", pickedTopic: "t" },
    });
    expect(replyTargetComment).toEqual({ text: "top", pickedTopic: "t" });
  });
});

describe("attachReplyTargetToPublished", () => {
  it("attaches onto object published", () => {
    expect(attachReplyTargetToPublished({ niconama: {} }, { text: "a", pickedTopic: "b" }))
      .toEqual({ niconama: {}, replyTargetComment: { text: "a", pickedTopic: "b" } });
  });
});
