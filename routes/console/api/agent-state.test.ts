import { afterEach, describe, expect, it, mock } from "bun:test";
import { setBroadcastingTarget } from "../../../lib/console-proxy";
import { GET } from "./agent-state";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
});

describe("GET /console/api/agent-state", () => {
  it("returns the response from /api/meta", async () => {
    setBroadcastingTarget("127.0.0.1", 8777);
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      expect(init?.signal).toBeDefined();
      return Response.json({
        niconama: {
          id: "lv123",
          title: "test",
        },
      });
    }) as unknown as typeof fetch;

    const res = await GET(
      new Request("http://127.0.0.1:8777/console/api/agent-state"),
    );
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({
      niconama: {
        id: "lv123",
        title: "test",
      },
    });
  });

  it("uses the configured broadcasting target when BROADCASTING_AGENT_API_BASE_URL is not set", async () => {
    setBroadcastingTarget("127.0.0.1", 7777);
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      expect(String(input)).toBe("http://127.0.0.1:7777/api/meta");
      expect(init?.signal).toBeDefined();
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;

    const res = await GET(
      new Request("http://127.0.0.1:8777/console/api/agent-state"),
    );
    expect(res.ok).toBe(true);
    await res.json();
  });

  it("returns 502 when /api/meta responds with non-ok status", async () => {
    globalThis.fetch = (async () =>
      new Response("internal error", {
        status: 500,
        statusText: "Internal Server Error",
      })) as unknown as typeof fetch;

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

  it("returns 502 with timeout message when upstream request times out", async () => {
    globalThis.fetch = ((_input: RequestInfo | URL) => {
      return Promise.reject(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    }) as unknown as typeof fetch;

    globalThis.setTimeout = ((handler: TimerHandler) => {
      if (typeof handler === "function") {
        handler();
      }
      return 1;
    }) as unknown as typeof setTimeout;
    const mockClearTimeout = mock((id: ReturnType<typeof setTimeout>) => id);
    globalThis.clearTimeout =
      mockClearTimeout as unknown as typeof clearTimeout;

    const res = await GET();
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data).toEqual({
      error: "failed to fetch /api/meta: request timed out (5000ms)",
    });
    expect(mockClearTimeout).toHaveBeenCalledWith(1);
  });
});
