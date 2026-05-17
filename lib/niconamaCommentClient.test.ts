import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureUserDataDirExists,
  extractWatchUrlFromHtml,
  hasCommentArrayStructure,
  parseAgentCommentsFromResponseBody,
} from "./niconamaCommentClient";

describe("extractWatchUrlFromHtml", () => {
  it("extracts relative /watch URLs from anchor tags", () => {
    const html = '<a href="/watch/lv123456">Watch</a>';
    expect(extractWatchUrlFromHtml(html, 'https://live.nicovideo.jp/')).toBe(
      'https://live.nicovideo.jp/watch/lv123456',
    );
  });

  it("extracts watchPageUrl values from JSON-like HTML", () => {
    const html = '...&quot;watchPageUrl&quot;:&quot;https://live.nicovideo.jp/watch/lv350350266?ref=TopPage-RecommendedProgramListSection-PlayerProgramCard&quot;...';
    expect(extractWatchUrlFromHtml(html, 'https://live.nicovideo.jp/')).toBe(
      'https://live.nicovideo.jp/watch/lv350350266?ref=TopPage-RecommendedProgramListSection-PlayerProgramCard',
    );
  });

  it("extracts watchPageUrlAtExtPlayer values from JSON-like HTML", () => {
    const html = '..."watchPageUrlAtExtPlayer":"https://ext.live.nicovideo.jp/watch/lv350350266"...';
    expect(extractWatchUrlFromHtml(html, 'https://live.nicovideo.jp/')).toBe(
      'https://ext.live.nicovideo.jp/watch/lv350350266',
    );
  });
});

describe("parseAgentCommentsFromResponseBody", () => {
  it("parses comments from a top-level comments array", () => {
    const body = {
      comments: [{ comment: "こんにちは", no: 1, anonymity: false, hasGift: false }],
    };

    const parsed = parseAgentCommentsFromResponseBody(body);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      data: expect.objectContaining({
        comment: "こんにちは",
        no: 1,
        anonymity: false,
        hasGift: false,
      }),
    });
  });

  it("parses comments from nested data arrays", () => {
    const body = {
      data: {
        comments: [{ comment: "こんばんは", no: 2, anonymity: true, hasGift: true, userId: "user123" }],
      },
    };

    const parsed = parseAgentCommentsFromResponseBody(body);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      data: expect.objectContaining({
        comment: "こんばんは",
        no: 2,
        anonymity: true,
        hasGift: true,
        userId: "user123",
      }),
    });
  });

  it("deduplicates repeated comments with the same signature", () => {
    const body = {
      comments: [
        { comment: "hello", no: 5, anonymity: false, hasGift: false },
        { comment: "hello", no: 5, anonymity: false, hasGift: false },
      ],
    };

    const parsed = parseAgentCommentsFromResponseBody(body);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.data.comment).toBe("hello");
  });

  it("deduplicates repeated comments across separate parse calls when sharing the same signature cache", () => {
    const body1 = {
      comments: [{ comment: "hello", no: 5, anonymity: false, hasGift: false }],
    };
    const body2 = {
      comments: [{ comment: "hello", no: 5, anonymity: false, hasGift: false }],
    };
    const seenSignatures = new Set<string>();

    const firstParsed = parseAgentCommentsFromResponseBody(body1, seenSignatures);
    const secondParsed = parseAgentCommentsFromResponseBody(body2, seenSignatures);

    expect(firstParsed).toHaveLength(1);
    expect(secondParsed).toHaveLength(0);
  });

  it("returns an empty result for an empty top-level comments array", () => {
    const body = { comments: [] };
    const parsed = parseAgentCommentsFromResponseBody(body);

    expect(parsed).toHaveLength(0);
  });

  it("returns an empty result for an empty nested data comments array", () => {
    const body = { data: { comments: [] } };
    const parsed = parseAgentCommentsFromResponseBody(body);

    expect(parsed).toHaveLength(0);
  });
});

describe("hasCommentArrayStructure", () => {
  it("returns true for an empty top-level comments array", () => {
    expect(hasCommentArrayStructure({ comments: [] })).toBe(true);
  });

  it("returns true for an empty nested data comments array", () => {
    expect(hasCommentArrayStructure({ data: { comments: [] } })).toBe(true);
  });

  it("returns true for an empty top-level data array", () => {
    expect(hasCommentArrayStructure({ data: [] })).toBe(true);
  });

  it("returns false for a response without comment arrays", () => {
    expect(hasCommentArrayStructure({ foo: 'bar' })).toBe(false);
  });
});

describe("ensureUserDataDirExists", () => {
  it("creates the directory when it does not exist", () => {
    const path = mkdtempSync(join(tmpdir(), "niconama-user-data-dir-"));
    const userDataDir = join(path, "auth-profile");

    try {
      ensureUserDataDirExists(userDataDir);
      expect(existsSync(userDataDir)).toBe(true);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it("throws when the path exists but is not a directory", () => {
    const path = mkdtempSync(join(tmpdir(), "niconama-user-data-dir-"));
    const filePath = join(path, "auth-profile");
    writeFileSync(filePath, "not a directory");

    try {
      expect(() => ensureUserDataDirExists(filePath)).toThrow(
        `userDataDir must be a directory: ${filePath}`,
      );
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });
});

