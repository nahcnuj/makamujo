import { describe, it, expect } from "bun:test";
import { createAgentStateStore } from "./useAgentState";

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

// Ensure a `window` global exists for URL helpers
if (typeof (globalThis as any).window === "undefined") {
  (globalThis as any).window = globalThis;
}

describe("createAgentStateStore", () => {
  it("connects and notifies subscribers on state changes", () => {
    const created: MockSocket[] = [];
    const makeWebSocket = (url: string) => {
      const s = new MockSocket(url);
      created.push(s);
      return s as any;
    };

    const store = createAgentStateStore({
      getUrl: () => "wss://example.com/console/api/ws",
      makeWebSocket,
    });

    const observed: any[] = [];
    const unsub = store.subscribe((s) => observed.push({ ...s }));

    store.connect();
    expect(created.length).toBe(1);

    // simulate open
    created[0]!.trigger("open", {});
    // simulate message
    created[0]!.trigger("message", { data: JSON.stringify({ niconama: { type: "live" } }) });

    expect(observed.some((s) => s.agentStateResponse && s.agentStateResponse.niconama?.type === "live")).toBe(true);

    unsub();
    store.cleanup();
  });

  it("sets error state on invalid JSON", () => {
    let socketInst: MockSocket | null = null;
    const makeWebSocket = (url: string) => {
      socketInst = new MockSocket(url);
      return socketInst as any;
    };

    const store = createAgentStateStore({ getUrl: () => "wss://x/", makeWebSocket });
    const observed: any[] = [];
    const unsub = store.subscribe((s) => observed.push({ ...s }));

    store.connect();
    socketInst!.trigger("message", { data: "{invalid" });

    expect(observed.some((s) => typeof s.agentStatusError === "string" && s.agentStatusError.length > 0)).toBe(true);

    unsub();
    store.cleanup();
  });
});
