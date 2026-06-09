import { describe, expect, it } from "bun:test";
import type { AgentComment } from "automated-gameplay-transmitter";
import {
  createNiconamaCommentClient,
  DEFAULT_WATCH_PAGE_BASE_URL,
} from "../../lib/niconamaCommentClient";

interface IMockWebSocket {
  url: string;
  readyState: number;
  onmessage: ((data: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(_data: unknown): void;
  close(): void;
  triggerMessage(obj: unknown): void;
}

const TEST_WATCH_URL = new URL("watch/test", DEFAULT_WATCH_PAGE_BASE_URL).href;

const createFakePlaywrightContext = () => {
  const fakePage = {
    on(_event: string, _callback: (event: unknown) => void) {},
    goto: async (_url: string) => null,
    waitForTimeout: async () => {},
    close: async () => {},
    evaluate: async <T>(_fn: () => T) => [] as any,
    getByText: () => ({
      count: async () => 0,
      first: () => ({
        hover: async () => {},
        waitFor: async () => {},
        count: async () => 0,
      }),
    }),
    locator: () => ({
      first: () => ({ getAttribute: async () => null, count: async () => 0 }),
    }),
    waitFor: async () => {},
    url: () => TEST_WATCH_URL,
    isClosed: () => false,
  };
  return {
    pages: () => [fakePage],
    newPage: async () => fakePage,
    close: async () => {},
  };
};

describe("NiconamaCommentClient lifecycle (mocked WebSocket + fetch)", () => {
  it("emits embedded-data initial comments and handles websocket messages", async () => {
    const originalFetch = (globalThis as any).fetch;
    const originalWebSocket = (globalThis as any).WebSocket;

    try {
      const embeddedHtml =
        '<script id="embedded-data" data-props="{&quot;relive&quot;:{&quot;webSocketUrl&quot;:&quot;wss://example.com/ws&quot;,&quot;comments&quot;:[{&quot;comment&quot;:&quot;embedded hello&quot;,&quot;no&quot;:10}]}}" ></script>';
      (globalThis as any).fetch = async () => ({
        ok: true,
        text: async () => embeddedHtml,
      });

      const sockets: unknown[] = [];
      class MockWebSocket {
        static OPEN = 1;
        static CLOSED = 3;
        public readyState: number;
        public url: string;
        public onopen: (() => void) | null = null;
        public onmessage: ((ev: { data: unknown }) => void) | null = null;
        public onclose:
          | ((ev: { code?: number; reason?: string }) => void)
          | null = null;
        public onerror: ((ev: unknown) => void) | null = null;

        constructor(url: string, _opts?: unknown) {
          this.url = url;
          this.readyState = MockWebSocket.OPEN;
          (sockets as unknown[]).push(this);
          setTimeout(() => {
            this.onopen?.();
          }, 0);
        }

        send(_data: unknown) {
          /* noop */
        }

        close() {
          this.readyState = MockWebSocket.CLOSED;
          if (this.onclose) this.onclose({ code: 1000, reason: "closed" });
        }

        triggerMessage(obj: unknown) {
          if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) });
        }
      }

      (globalThis as any).WebSocket = MockWebSocket;

      const launchPersistentContext = async () => createFakePlaywrightContext();
      const collectedComments: AgentComment[] = [];
      const collectedMeta: unknown[] = [];

      const client = createNiconamaCommentClient(
        { watchUrl: TEST_WATCH_URL, launchPersistentContext },
        {
          onComments: (c) => {
            collectedComments.push(...c);
          },
          onMeta: (m) => {
            collectedMeta.push(m);
          },
          onError: (e) => {
            throw e;
          },
        },
      );

      await client.start();
      await new Promise((res) => setTimeout(res, 20));

      expect(collectedComments.length).toBeGreaterThanOrEqual(1);
      expect((collectedComments[0] as AgentComment).data.comment).toBe(
        "embedded hello",
      );

      const ws = sockets[0] as any;
      expect(ws).toBeTruthy();

      ws.triggerMessage({
        type: "statistics",
        data: { viewers: 123, comments: 7, adPoints: 100, giftPoints: 2 },
      });
      ws.triggerMessage({
        type: "actionComment",
        data: { comment: "hello from websocket", no: 99, anonymity: false },
      });

      await new Promise((res) => setTimeout(res, 20));

      expect(
        collectedMeta.some((m) => m && (m as Record<string, unknown>).niconama),
      ).toBe(true);
      expect(
        collectedComments.some(
          (c) => c.data?.comment === "hello from websocket",
        ),
      ).toBe(true);

      await client.stop();
      expect((ws as any).readyState).toBe(MockWebSocket.CLOSED);
    } finally {
      (globalThis as any).fetch = originalFetch;
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });

  it("deduplicates comments across embedded-data and websocket frames", async () => {
    const originalFetch = (globalThis as any).fetch;
    const originalWebSocket = (globalThis as any).WebSocket;

    try {
      const embeddedHtml =
        '<script id="embedded-data" data-props="{&quot;relive&quot;:{&quot;webSocketUrl&quot;:&quot;wss://example.com/ws&quot;,&quot;comments&quot;:[{&quot;comment&quot;:&quot;dup comment&quot;,&quot;no&quot;:5}]}}" ></script>';
      (globalThis as any).fetch = async () => ({
        ok: true,
        text: async () => embeddedHtml,
      });

      const sockets: IMockWebSocket[] = [];
      class MockWebSocket2 {
        static OPEN = 1;
        static CLOSED = 3;
        public readyState: number;
        public url: string;
        public onopen: (() => void) | null = null;
        public onmessage: ((ev: { data: unknown }) => void) | null = null;
        public onclose:
          | ((ev: { code?: number; reason?: string }) => void)
          | null = null;
        public onerror: ((ev: unknown) => void) | null = null;
        constructor(_url: string) {
          this.url = _url;
          this.readyState = MockWebSocket2.OPEN;
          sockets.push(this);
          setTimeout(() => {
            this.onopen?.();
          }, 0);
        }
        send() {}
        close() {
          this.readyState = MockWebSocket2.CLOSED;
          if (this.onclose) this.onclose({});
        }
        triggerMessage(obj: unknown) {
          if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) });
        }
      }
      (globalThis as any).WebSocket = MockWebSocket2;

      const launchPersistentContext = async () => createFakePlaywrightContext();
      const collectedComments: unknown[] = [];

      const client = createNiconamaCommentClient(
        { watchUrl: TEST_WATCH_URL, launchPersistentContext },
        {
          onComments: (c) => {
            collectedComments.push(...c);
          },
          onMeta: () => {},
          onError: (e) => {
            throw e;
          },
        },
      );

      await client.start();
      await new Promise((res) => setTimeout(res, 20));

      expect(collectedComments).toHaveLength(1);

      const ws = sockets[0] as any;
      ws.triggerMessage({
        type: "actionComment",
        data: { comment: "dup comment", no: 5 },
      });

      await new Promise((res) => setTimeout(res, 20));

      expect(collectedComments).toHaveLength(1);

      await client.stop();
    } finally {
      (globalThis as any).fetch = originalFetch;
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });

  it("skips direct websocket when runtime WebSocket support is unavailable", async () => {
    const originalFetch = (globalThis as any).fetch;
    const originalWebSocket = (globalThis as any).WebSocket;

    try {
      const embeddedHtml =
        '<script id="embedded-data" data-props="{&quot;relive&quot;:{&quot;webSocketUrl&quot;:&quot;wss://example.com/ws&quot;,&quot;comments&quot;:[{&quot;comment&quot;:&quot;embedded hello&quot;,&quot;no&quot;:10}]}}"></script>';
      (globalThis as any).fetch = async () => ({
        ok: true,
        text: async () => embeddedHtml,
      });
      delete (globalThis as any).WebSocket;

      const launchPersistentContext = async () => createFakePlaywrightContext();
      const collectedComments: Record<string, unknown>[] = [];
      const collectedMeta: Record<string, unknown>[] = [];

      const client = createNiconamaCommentClient(
        { watchUrl: TEST_WATCH_URL, launchPersistentContext },
        {
          onComments: (c) => {
            collectedComments.push(...c);
          },
          onMeta: (m) => {
            collectedMeta.push(m as any);
          },
          onError: (e) => {
            throw e;
          },
        },
      );

      await client.start();
      await new Promise((res) => setTimeout(res, 20));

      expect(collectedComments.length).toBeGreaterThanOrEqual(1);
      expect(collectedMeta.length).toBeGreaterThanOrEqual(1);

      await client.stop();
    } finally {
      (globalThis as any).fetch = originalFetch;
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });

  it("starts Playwright comment watcher and emits page comments from websocket frames and responses", async () => {
    const originalFetch = (globalThis as any).fetch;
    const originalWebSocket = (globalThis as any).WebSocket;

    try {
      const embeddedHtml =
        '<script id="embedded-data" data-props="{&quot;relive&quot;:{&quot;webSocketUrl&quot;:&quot;wss://example.com/ws&quot;}}"></script>';
      (globalThis as any).fetch = async () => ({
        ok: true,
        text: async () => embeddedHtml,
      });
      delete (globalThis as any).WebSocket;

      let websocketCallback: unknown = null;
      let responseCallback: unknown = null;
      let gotoUrl: string = "";
      let playwrightClosed = false;

      const fakePage = {
        on(event: string, callback: unknown) {
          if (event === "websocket") websocketCallback = callback as any;
          if (event === "response") responseCallback = callback as any;
        },
        goto: async (url: string) => {
          gotoUrl = url;
          return null;
        },
        waitForTimeout: async () => {},
        close: async () => {
          playwrightClosed = true;
        },
        evaluate: async <T>(_fn: () => T) => [] as any,
        getByText: () => ({
          count: async () => 0,
          first: () => ({
            hover: async () => {},
            waitFor: async () => {},
            count: async () => 0,
          }),
        }),
        locator: () => ({
          first: () => ({
            getAttribute: async () => null,
            count: async () => 0,
          }),
        }),
        waitFor: async () => {},
        url: () => TEST_WATCH_URL,
        isClosed: () => false,
      };

      const fakeContext = {
        pages: () => [fakePage],
        newPage: async () => fakePage,
        close: async () => {
          playwrightClosed = true;
        },
      };

      const launchPersistentContext = async () => fakeContext;

      const collectedComments: Record<string, unknown>[] = [];
      const collectedMeta: Record<string, unknown>[] = [];

      const client = createNiconamaCommentClient(
        { watchUrl: TEST_WATCH_URL, launchPersistentContext },
        {
          onComments: (c) => {
            collectedComments.push(...c);
          },
          onMeta: (m) => {
            collectedMeta.push(m as any);
          },
          onError: (e) => {
            throw e;
          },
        },
      );

      await client.start();
      await new Promise((res) => setTimeout(res, 20));

      expect(gotoUrl).toBe(TEST_WATCH_URL);
      expect(websocketCallback).toBeTruthy();
      expect(responseCallback).toBeTruthy();

      const fakeSocket = {
        url: () => "wss://browser.example/test",
        on(event: string, callback: unknown) {
          if (event === "framereceived") {
            setTimeout(
              () =>
                (callback as any)({
                  payload: JSON.stringify({
                    comments: [{ comment: "page websocket comment", no: 123 }],
                  }),
                }),
              0,
            );
          }
        },
      };

      (websocketCallback as any)?.(fakeSocket);

      (responseCallback as any)?.({
        headers: () => ({ "content-type": "application/json" }),
        text: async () =>
          JSON.stringify({
            comments: [{ comment: "page response comment", no: 124 }],
          }),
        url: () => "https://playwright.mock/response",
      });

      await new Promise((res) => setTimeout(res, 20));

      expect(
        collectedComments.some(
          (c) => (c as any).data.comment === "page websocket comment",
        ),
      ).toBe(true);
      expect(
        collectedComments.some(
          (c) => (c as any).data.comment === "page response comment",
        ),
      ).toBe(true);

      await client.stop();
      expect(playwrightClosed).toBe(true);
    } finally {
      (globalThis as any).fetch = originalFetch;
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });
});
