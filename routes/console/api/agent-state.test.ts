import { afterEach, describe, expect, it } from "bun:test";
import { GET } from "./agent-state";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GET /console/api/agent-state", () => {
  it("returns the response from /api/meta", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        niconama: {
          id: "lv123",
          title: "test",
        },
      })) as unknown as typeof fetch;

    const res = await GET();
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({
      niconama: {
        id: "lv123",
        title: "test",
      },
    });
  });
});
