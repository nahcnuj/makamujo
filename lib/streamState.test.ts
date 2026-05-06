import { describe, expect, it } from "bun:test";
import { normalizePublishedStreamState } from "./streamState";

describe("normalizePublishedStreamState", () => {
  it("preserves replyTargetComment for legacy niconama payloads", () => {
    const legacyState = {
      type: "niconama",
      data: {
        title: "legacy",
        isLive: true,
        startTime: 1234567890,
        total: 42,
        points: { gift: 5, ad: 1 },
        url: "https://example.com",
      },
      replyTargetComment: {
        text: "返信対象コメントです",
        pickedTopic: "返信",
      },
    };

    const normalized = normalizePublishedStreamState(legacyState) as Record<string, unknown>;

    expect(normalized.replyTargetComment).toEqual(legacyState.replyTargetComment);
    expect(normalized).toHaveProperty("niconama");
    expect((normalized.niconama as Record<string, unknown>).type).toBe("live");
    expect((normalized.niconama as Record<string, unknown>).meta).toEqual({
      title: "legacy",
      url: "https://example.com",
      start: 1234567890,
      total: { listeners: 42, gift: 5, ad: 1 },
    });
  });

  it("preserves replyTargetComment for raw live payloads", () => {
    const legacyState = {
      type: "live",
      title: "live state",
      total: 7,
      replyTargetComment: {
        text: "返信対象コメントです",
        pickedTopic: "返信",
      },
    };

    const normalized = normalizePublishedStreamState(legacyState) as Record<string, unknown>;

    expect(normalized.replyTargetComment).toEqual(legacyState.replyTargetComment);
    expect(normalized).toHaveProperty("niconama");
    expect((normalized.niconama as Record<string, unknown>).type).toBe("live");
    expect((normalized.niconama as Record<string, unknown>).title).toBe("live state");
  });

  it("preserves additional top-level fields for legacy payloads", () => {
    const legacyState = {
      type: "niconama",
      data: {
        isLive: false,
        title: "legacy",
        startTime: 0,
        total: 1,
        points: { gift: 0, ad: 0 },
        url: "https://example.com",
      },
      replyTargetComment: {
        text: "返信対象コメントです",
        pickedTopic: "返信",
      },
      commentCount: 7,
    };

    const normalized = normalizePublishedStreamState(legacyState) as Record<string, unknown>;

    expect(normalized.replyTargetComment).toEqual(legacyState.replyTargetComment);
    expect(normalized.commentCount).toBe(7);
    expect(normalized).toHaveProperty("niconama");
  });
});
