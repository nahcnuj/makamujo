import { describe, expect, it } from "bun:test";
import { normalizePublishedStreamState, resolveNiconamaFromState } from "./streamState";

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

  it("preserves comments count from legacy niconama.total object", () => {
    const legacyState = {
      type: "niconama",
      data: {
        isLive: true,
        title: "legacy",
        startTime: 0,
        total: { listeners: 10, comments: 4 },
        points: { gift: 1, ad: 2 },
        url: "https://example.com",
      },
    };

    const normalized = normalizePublishedStreamState(legacyState) as Record<string, any>;

    expect(normalized.niconama.meta.total).toEqual({ listeners: 10, comments: 4, gift: 1, ad: 2 });
  });

  it("maps top-level title/url/start into niconama.meta", () => {
    const state = {
      title: "TopLevelTitle",
      url: "https://example.com/live",
      start: 1700000000,
    };

    const normalized = resolveNiconamaFromState(state) as Record<string, any>;

    expect(normalized).toHaveProperty('meta');
    expect(normalized.meta.title).toBe('TopLevelTitle');
    expect(normalized.meta.url).toBe('https://example.com/live');
    expect(normalized.meta.start).toBe(1700000000);
  });

  it("promotes niconama.title into niconama.meta when meta is missing", () => {
    const state = {
      niconama: { type: 'live', title: 'NicoTitle' },
    } as any;

    const normalized = resolveNiconamaFromState(state) as Record<string, any>;

    expect(normalized).toHaveProperty('meta');
    expect(normalized.meta.title).toBe('NicoTitle');
    expect(normalized.type).toBe('live');
  });

  it("extracts metadata from currentGame.state when niconama/meta missing", () => {
    const state = {
      currentGame: { name: 'CookieClicker', state: { title: 'CookieClicker - play', url: 'https://orteil.dashnet.org/cookieclicker/', timestamp: 1779541505333 } },
    } as any;

    const normalized = resolveNiconamaFromState(state) as Record<string, any>;
    expect(normalized).toHaveProperty('meta');
    expect(normalized.meta.title).toBe('CookieClicker - play');
    expect(normalized.meta.url).toBe('https://orteil.dashnet.org/cookieclicker/');
    expect(normalized.meta.start).toBe(1779541505333);
  });
});
