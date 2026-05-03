import { afterEach, describe, expect, it, mock } from "bun:test";
import { GET } from "./speech-history";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
});

describe("GET /console/api/speech-history", () => {
  it("proxies the response from /api/speech-history", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/api/speech-history");
      return Response.json({ items: [{ id: "speech-1", speech: "テスト", nGram: 4 }], hasMore: false });
    }) as unknown as typeof fetch;

    const req = new Request("http://localhost/console/api/speech-history");
    const res = await GET(req);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ items: [{ id: "speech-1", speech: "テスト", nGram: 4 }], hasMore: false });
  });

  it("forwards before and limit query parameters", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("before")).toBe("speech-20");
      expect(url.searchParams.get("limit")).toBe("10");
      return Response.json({ items: [], hasMore: false });
    }) as unknown as typeof fetch;

    const req = new Request("http://localhost/console/api/speech-history?before=speech-20&limit=10");
    const res = await GET(req);
    expect(res.ok).toBe(true);
  });

  it("returns 502 when upstream responds with non-ok status", async () => {
    globalThis.fetch = (async () =>
      new Response("internal error", { status: 500, statusText: "Internal Server Error" })
    ) as unknown as typeof fetch;

    const req = new Request("http://localhost/console/api/speech-history");
    const res = await GET(req);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data).toEqual({
      error: "failed to fetch /api/speech-history: 500 Internal Server Error",
    });
  });

  it("returns 502 when fetch throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const req = new Request("http://localhost/console/api/speech-history");
    const res = await GET(req);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data).toEqual({
      error: "failed to fetch /api/speech-history: connection refused",
    });
  });

  it("returns 502 with timeout message when request times out", async () => {
    globalThis.fetch = ((_input: RequestInfo | URL) => {
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    }) as unknown as typeof fetch;

    globalThis.setTimeout = (((handler: TimerHandler) => {
      if (typeof handler === "function") {
        handler();
      }
      return 1;
    }) as unknown) as typeof setTimeout;
    const mockClearTimeout = mock((id: ReturnType<typeof setTimeout>) => id);
    globalThis.clearTimeout = mockClearTimeout as unknown as typeof clearTimeout;

    const req = new Request("http://localhost/console/api/speech-history");
    const res = await GET(req);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("request timed out");
    expect(mockClearTimeout).toHaveBeenCalledWith(1);
  });
});
