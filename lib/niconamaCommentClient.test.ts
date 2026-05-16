import { describe, expect, it } from "bun:test";
import { parseAgentCommentsFromResponseBody } from "./niconamaCommentClient";

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
