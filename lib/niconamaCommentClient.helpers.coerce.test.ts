import { describe, expect, it } from "bun:test";
import { coerceToAgentComments } from "./niconamaCommentClient.helpers";

describe("coerceToAgentComments", () => {
  it("parses array of raw comment objects", () => {
    const input = [{ comment: 'hello', no: 1, userId: 'u1' }];
    const res = coerceToAgentComments(input);
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(1);
    expect((res[0] as any).data.comment).toBe('hello');
    expect((res[0] as any).data.no).toBe(1);
    expect((res[0] as any).data.userId).toBe('u1');
  });

  it("parses single raw comment object", () => {
    const input = { comment: 'solo', userId: 'u2' };
    const res = coerceToAgentComments(input);
    expect(res.length).toBe(1);
    expect((res[0] as any).data.comment).toBe('solo');
    expect((res[0] as any).data.userId).toBe('u2');
  });

  it("parses JSON string with nested data.comments", () => {
    const inputObj = { data: [{ comment: 'json', userId: 'u3' }] };
    const input = JSON.stringify(inputObj);
    const res = coerceToAgentComments(input);
    expect(res.length).toBe(1);
    expect((res[0] as any).data.comment).toBe('json');
    expect((res[0] as any).data.userId).toBe('u3');
  });

  it("parses NDJSON", () => {
    const line1 = JSON.stringify({ comment: 'nd1', userId: 'u4' });
    const line2 = JSON.stringify({ comment: 'nd2', userId: 'u5' });
    const input = `${line1}\n${line2}\n`;
    const res = coerceToAgentComments(input);
    expect(res.length).toBe(2);
    expect((res[0] as any).data.comment).toBe('nd1');
    expect((res[1] as any).data.comment).toBe('nd2');
  });

  it("returns empty for plain string", () => {
    expect(coerceToAgentComments('hello')).toEqual([]);
  });
});
