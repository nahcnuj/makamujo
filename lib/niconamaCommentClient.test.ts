import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureUserDataDirExists, parseAgentCommentsFromResponseBody } from "./niconamaCommentClient";

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
