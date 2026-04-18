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

  it("returns 502 when /api/meta responds with non-ok status", async () => {
    globalThis.fetch = (async () => new Response("internal error", { status: 500, statusText: "Internal Server Error" })) as unknown as typeof fetch;

    const res = await GET();
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data).toEqual({
      error: "failed to fetch /api/meta: 500 Internal Server Error",
    });
  });

  it("returns 502 when fetch throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const res = await GET();
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data).toEqual({
      error: "failed to fetch /api/meta: connection refused",
    });
  });
});
