import { describe, it, expect } from "bun:test";
import { createWebSocketConnector, createAgentStateWebSocketUrl, parseAgentStateResponse } from "./useAgentState";

// Ensure a `window` global exists for the connector (used by the implementation checks)
if (typeof (globalThis as any).window === "undefined") {
  (globalThis as any).window = globalThis;
}

// Minimal mock socket that supports addEventListener and manual event triggers
class MockSocket {
  url: string;
  listeners: Record<string, Array<(ev?: any) => void>> = {};
  closed = false;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, handler: (ev?: any) => void) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }
  trigger(type: string, ev?: any) {
    (this.listeners[type] || []).forEach((h) => h(ev));
  }
  close() {
    this.closed = true;
    this.trigger("close", {});
  }
}

describe("createAgentStateWebSocketUrl", () => {
  it("builds the expected wss URL", () => {
    expect(createAgentStateWebSocketUrl("wss://localhost/console/")).toBe("wss://localhost/console/api/ws");
  });
});

describe("parseAgentStateResponse", () => {
  it("parses valid JSON", () => {
    const parsed = parseAgentStateResponse('{"niconama":{"type":"live"}}');
    expect(parsed.niconama?.type).toBe("live");
  });
  it("throws on invalid JSON", () => {
    let threw = false;
    try {
      parseAgentStateResponse('{invalid');
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(SyntaxError);
    }
    expect(threw).toBe(true);
  });
});

describe("createWebSocketConnector", () => {
  it("uses provided URL factory and makes a socket", () => {
    const urls: string[] = [];
    const makeWebSocket = (url: string) => {
      urls.push(url);
      return new MockSocket(url);
    };
    const connector = createWebSocketConnector({
      getUrl: () => "wss://example.com/console/api/ws",
      makeWebSocket,
      onMessage: () => {},
    });
    connector.connect();
    expect(urls[0]).toBe("wss://example.com/console/api/ws");
    connector.cleanup();
  });

  it("parses messages and calls onMessage/onError appropriately", () => {
    let received: any = null;
    let lastError = "";
    let socketInstance: MockSocket | null = null;
    const makeWebSocket = (url: string) => {
      socketInstance = new MockSocket(url);
      return socketInstance as any;
    };

    const connector = createWebSocketConnector({
      getUrl: () => "wss://example.com/console/api/ws",
      makeWebSocket,
      onMessage: (r) => { received = r; },
      onError: (m) => { lastError = m; },
    });

    connector.connect();
    // send valid JSON
    socketInstance!.trigger("message", { data: JSON.stringify({ niconama: { type: "live" } }) });
    expect(received?.niconama?.type).toBe("live");

    // send invalid JSON -> error
    socketInstance!.trigger("message", { data: "{invalid-json" });
    expect(lastError).toContain("配信状態の応答形式が不正です。");

    connector.cleanup();
  });

  it("schedules reconnect on close and allows manual invocation of timer callback", () => {
    const created: MockSocket[] = [];
    const makeWebSocket = (url: string) => {
      const s = new MockSocket(url);
      created.push(s);
      return s as any;
    };

    const timers: Array<() => void> = [];
    const setTimeoutImpl = (cb: () => void, ms: number) => { timers.push(cb); return timers.length - 1; };
    const clearTimeoutImpl = (id: number) => { timers[id] = () => {}; };

    const connector = createWebSocketConnector({
      getUrl: () => "wss://example.com/console/api/ws",
      makeWebSocket,
      reconnectDelayMs: 10,
      setTimeoutImpl,
      clearTimeoutImpl,
      onMessage: () => {},
    });

    connector.connect();
    expect(created.length).toBe(1);
    // simulate close -> should schedule a reconnect
    created[0]!.trigger("close", {});
    expect(timers.length).toBe(1);
    // invoke scheduled reconnect callback -> should create another socket
    timers[0]!();
    expect(created.length).toBe(2);

    connector.cleanup();
  });
});
