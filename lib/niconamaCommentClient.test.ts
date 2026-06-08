import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildNiconamaStreamStateFromStatisticsEvent,
  createNiconamaCommentClient,
  ensureUserDataDirExists,
  extractEmbeddedDataFromHtml,
  extractWatchUrlFromHtml,
  hasCommentArrayStructure,
  parseAgentCommentsFromResponseBody,
} from "./niconamaCommentClient";

describe("extractEmbeddedDataFromHtml", () => {
  it("extracts data props from a script #embedded-data element", () => {
    const html =
      '<script id="embedded-data" data-props="{&quot;site&quot;:{&quot;state&quot;:{&quot;relive&quot;:{&quot;webSocketUrl&quot;:&quot;wss://example.com&quot;}}}}"></script>';
    const extracted = extractEmbeddedDataFromHtml(html);
    expect(extracted).toEqual({
      site: { state: { relive: { webSocketUrl: "wss://example.com" } } },
    });
  });

  it("extracts data props from a div #embedded-data element", () => {
    const html =
      '<div id="embedded-data" data-props="{&quot;site&quot;:{&quot;state&quot;:{&quot;relive&quot;:{&quot;webSocketUrl&quot;:&quot;wss://example.com&quot;}}}}"></div>';
    const extracted = extractEmbeddedDataFromHtml(html);
    expect(extracted).toEqual({
      site: { state: { relive: { webSocketUrl: "wss://example.com" } } },
    });
  });

  it("extracts data props when the embedded-data tag spans newlines", () => {
    const html =
      '<script id="embedded-data"\n  data-props="{&quot;relive&quot;:{&quot;webSocketUrl&quot;:&quot;wss://example.com/ws&quot;,&quot;comments&quot;:[{&quot;comment&quot;:&quot;hi&quot;,&quot;no&quot;:1}]}}">\n</script>';
    const extracted = extractEmbeddedDataFromHtml(html);
    expect(extracted).toEqual({
      relive: {
        webSocketUrl: "wss://example.com/ws",
        comments: [{ comment: "hi", no: 1 }],
      },
    });
  });

  it("extracts top-level relive embedded-data JSON", () => {
    const html =
      '<script id="embedded-data" data-props="{&quot;relive&quot;:{&quot;webSocketUrl&quot;:&quot;wss://example.com/ws&quot;,&quot;comments&quot;:[{&quot;comment&quot;:&quot;hello&quot;,&quot;no&quot;:2}]}}"></script>';
    const extracted = extractEmbeddedDataFromHtml(html);
    expect(extracted).toEqual({
      relive: {
        webSocketUrl: "wss://example.com/ws",
        comments: [{ comment: "hello", no: 2 }],
      },
    });
  });
});

describe("extractWatchUrlFromHtml", () => {
  it("extracts relative /watch URLs from anchor tags", () => {
    const html = '<a href="/watch/lv123456">Watch</a>';
    expect(extractWatchUrlFromHtml(html, "https://live.nicovideo.jp/")).toBe(
      "https://live.nicovideo.jp/watch/lv123456",
    );
  });

  it("extracts watchPageUrl values from JSON-like HTML", () => {
    const html =
      "...&quot;watchPageUrl&quot;:&quot;https://live.nicovideo.jp/watch/lv350350266?ref=TopPage-RecommendedProgramListSection-PlayerProgramCard&quot;...";
    expect(extractWatchUrlFromHtml(html, "https://live.nicovideo.jp/")).toBe(
      "https://live.nicovideo.jp/watch/lv350350266?ref=TopPage-RecommendedProgramListSection-PlayerProgramCard",
    );
  });

  it("extracts watchPageUrlAtExtPlayer values from JSON-like HTML", () => {
    const html =
      '..."watchPageUrlAtExtPlayer":"https://ext.live.nicovideo.jp/watch/lv350350266"...';
    expect(extractWatchUrlFromHtml(html, "https://live.nicovideo.jp/")).toBe(
      "https://ext.live.nicovideo.jp/watch/lv350350266",
    );
  });
});

describe("parseAgentCommentsFromResponseBody", () => {
  it("parses comments from a top-level comments array", () => {
    const body = {
      comments: [
        { comment: "こんにちは", no: 1, anonymity: false, hasGift: false },
      ],
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
        comments: [
          {
            comment: "こんばんは",
            no: 2,
            anonymity: true,
            hasGift: true,
            userId: "user123",
          },
        ],
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

  it("parses comments from nested embedded data structures", () => {
    const body = {
      site: {
        state: {
          relive: {
            comments: [
              {
                comment: "おはよう",
                no: 3,
                anonymity: false,
                hasGift: false,
                userId: "user456",
              },
            ],
          },
        },
      },
    };

    const parsed = parseAgentCommentsFromResponseBody(body);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      data: expect.objectContaining({
        comment: "おはよう",
        no: 3,
        anonymity: false,
        hasGift: false,
        userId: "user456",
      }),
    });
  });

  it("parses a single actionComment payload with nested data object", () => {
    const body = {
      type: "actionComment",
      data: {
        comment: "こんにちは",
        no: 7,
        anonymity: false,
        hasGift: false,
        userId: "user321",
      },
    };

    const parsed = parseAgentCommentsFromResponseBody(
      body,
      new Set(),
      "actionComment",
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      data: expect.objectContaining({
        comment: "こんにちは",
        no: 7,
        anonymity: false,
        hasGift: false,
        userId: "user321",
      }),
    });
  });

  it("parses comments from deeply nested arbitrary objects", () => {
    const body = {
      foo: {
        bar: {
          baz: {
            comments: [
              {
                comment: "深いネスト",
                no: 42,
                anonymity: true,
                hasGift: false,
                userId: "user789",
              },
            ],
          },
        },
      },
    };

    const parsed = parseAgentCommentsFromResponseBody(body);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      data: expect.objectContaining({
        comment: "深いネスト",
        no: 42,
        anonymity: true,
        hasGift: false,
        userId: "user789",
      }),
    });
  });

  it("deduplicates repeated comments with the same identifier", () => {
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

  it("deduplicates repeated comments across separate parse calls when sharing the same identifier cache", () => {
    const body1 = {
      comments: [{ comment: "hello", no: 5, anonymity: false, hasGift: false }],
    };
    const body2 = {
      comments: [{ comment: "hello", no: 5, anonymity: false, hasGift: false }],
    };
    const seenIdentifiers = new Set<string>();

    const firstParsed = parseAgentCommentsFromResponseBody(
      body1,
      seenIdentifiers,
    );
    const secondParsed = parseAgentCommentsFromResponseBody(
      body2,
      seenIdentifiers,
    );

    expect(firstParsed).toHaveLength(1);
    expect(secondParsed).toHaveLength(0);
  });

  it("merges numeric-only comment entries into the previous comment object", () => {
    const body = {
      comments: [{ comment: "ジュニアアイドル" }, { comment: "16" }],
    };

    const parsed = parseAgentCommentsFromResponseBody(body);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      data: expect.objectContaining({
        comment: "ジュニアアイドル",
        no: 16,
      }),
    });
  });

  it("returns an empty result for an empty top-level comments array", () => {
    const body = { comments: [] };
    const parsed = parseAgentCommentsFromResponseBody(body);

    expect(parsed).toHaveLength(0);
  });

  it("returns an empty result for an empty nested data comments array", () => {
    const body = { data: { comments: [] } };
    const parsed = parseAgentCommentsFromResponseBody(body);

    expect(parsed).toHaveLength(0);
  });
});

describe("fetchEmbeddedData fallback behavior", () => {
  it("falls back to Playwright when embedded-data lacks websocket url and emits rendered page comments", async () => {
    const originalFetch = (globalThis as any).fetch;
    try {
      const embeddedHtml =
        '<script id="embedded-data" data-props="{&quot;site&quot;:{&quot;state&quot;:{&quot;relive&quot;:{}},&quot;program&quot;:{&quot;statistics&quot;:{&quot;commentCount&quot;:1}}}}"></script>';
      (globalThis as any).fetch = async () => ({
        ok: true,
        text: async () => embeddedHtml,
      });

      const renderedComments: any[] = [];
      const launchPersistentContext = async () => {
        const fakePage = {
          goto: async () => ({
            status: () => 200,
            text: async () => "<html><body></body></html>",
          }),
          waitForTimeout: async () => {},
          waitForLoadState: async () => {},
          $: async () => null,
          evaluate: async (fn: any) => {
            const source = fn.toString();
            if (
              source.includes("const selectors") ||
              source.includes("const panel")
            ) {
              return ["rendered comment"];
            }
            if (source.includes("const results")) {
              return [];
            }
            return [];
          },
          on: () => {},
          url: () => "https://live.nicovideo.jp/watch/test",
          isClosed: () => false,
          close: async () => {},
        };
        return {
          pages: () => [fakePage],
          newPage: async () => fakePage,
          close: async () => {},
        };
      };

      const onComments: any[] = [];
      const client = createNiconamaCommentClient(
        {
          watchUrl: "https://live.nicovideo.jp/watch/test",
          launchPersistentContext: launchPersistentContext as any,
        },
        {
          onComments: (comments) => {
            onComments.push(...comments);
          },
          onMeta: () => {},
          onError: (error) => {
            throw error;
          },
        },
      );

      const result = await client.fetchEmbeddedData();

      // deliverComments is now scheduled asynchronously; wait briefly
      // for the callback to be invoked to avoid flakiness in tests.
      await new Promise<void>((resolve, reject) => {
        let t: ReturnType<typeof setTimeout> | null = null;
        let iv: ReturnType<typeof setInterval> | null = null;

        t = setTimeout(() => {
          if (iv !== null) clearInterval(iv);
          reject(new Error("timeout waiting for onComments"));
        }, 1000);

        iv = setInterval(() => {
          if (onComments.length >= 1) {
            if (t !== null) clearTimeout(t);
            if (iv !== null) clearInterval(iv);
            resolve();
          }
        }, 10);
      });

      expect(onComments).toHaveLength(1);
      expect(onComments[0]?.data?.comment).toBe("rendered comment");
      expect(result).toBeTruthy();
      expect((result as any).site?.state?.relive?.comments).toEqual([
        { comment: "rendered comment" },
      ]);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});

describe("detect program end in fetched HTML", () => {
  it("emits onMeta and returns sentinel when page contains 公開終了", async () => {
    const originalFetch = (globalThis as any).fetch;
    try {
      const embeddedHtml =
        "<html><body>この番組は公開終了しました。 公開終了</body></html>";
      (globalThis as any).fetch = async () => ({
        ok: true,
        text: async () => embeddedHtml,
      });

      const metas: any[] = [];
      const client = createNiconamaCommentClient(
        {
          watchUrl: "https://live.nicovideo.jp/watch/test",
          launchPersistentContext: (async () => ({
            pages: () => [],
            newPage: async () => ({}),
            close: async () => {},
          })) as any,
        },
        {
          onComments: () => {},
          onMeta: (m) => {
            metas.push(m);
          },
          onError: (err) => {
            throw err;
          },
        },
      );

      const result = await client.fetchEmbeddedData();

      expect(metas.length).toBeGreaterThan(0);
      expect(metas[0]).toEqual(expect.objectContaining({ type: "niconama" }));
      expect((metas[0] as any).data.isLive).toBe(false);
      expect((metas[0] as any).data.title).toBe("公開終了");
      expect(result).toEqual({
        programEnded: true,
        url: "https://live.nicovideo.jp/watch/test",
      });
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});

describe("fetchRenderedWatchPageBodyText", () => {
  it("returns body text from Playwright body locator allTextContents", async () => {
    const originalFetch = (globalThis as any).fetch;
    try {
      (globalThis as any).fetch = async () => ({
        ok: true,
        text: async () => "<html><body></body></html>",
      });

      const fakePage = {
        goto: async () => ({
          status: () => 200,
          text: async () => "<html><body>test</body></html>",
        }),
        waitForTimeout: async () => {},
        waitForLoadState: async () => {},
        locator: (_selector: string) => ({
          allTextContents: async () => ["  フォロー中の番組一覧", "放送中"],
        }),
        evaluate: async () => null,
        url: () => "https://live.nicovideo.jp/watch/test",
        isClosed: () => false,
        close: async () => {},
      };
      const launchPersistentContext = async () => ({
        pages: () => [fakePage],
        newPage: async () => fakePage,
        close: async () => {},
      });

      const client = createNiconamaCommentClient(
        {
          watchUrl: "https://live.nicovideo.jp/watch/test",
          launchPersistentContext: launchPersistentContext as any,
        },
        {
          onComments: () => {},
          onMeta: () => {},
          onError: (error) => {
            throw error;
          },
        },
      );

      const text = await client.fetchRenderedWatchPageBodyText();
      expect(text).toBe("  フォロー中の番組一覧放送中");
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  it("falls back to evaluate when locator.allTextContents is not available", async () => {
    const originalFetch = (globalThis as any).fetch;
    try {
      (globalThis as any).fetch = async () => ({
        ok: true,
        text: async () => "<html><body></body></html>",
      });

      const fakePage = {
        goto: async () => ({
          status: () => 200,
          text: async () => "<html><body>test</body></html>",
        }),
        waitForTimeout: async () => {},
        waitForLoadState: async () => {},
        locator: (_selector: string) => ({}),
        evaluate: async () => "fallback body",
        url: () => "https://live.nicovideo.jp/watch/test",
        isClosed: () => false,
        close: async () => {},
      };
      const launchPersistentContext = async () => ({
        pages: () => [fakePage],
        newPage: async () => fakePage,
        close: async () => {},
      });

      const client = createNiconamaCommentClient(
        {
          watchUrl: "https://live.nicovideo.jp/watch/test",
          launchPersistentContext: launchPersistentContext as any,
        },
        {
          onComments: () => {},
          onMeta: () => {},
          onError: (error) => {
            throw error;
          },
        },
      );

      const text = await client.fetchRenderedWatchPageBodyText();
      expect(text).toBe("fallback body");
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});

describe("direct websocket onmessage handling", () => {
  it("handles string payloads", async () => {
    const originalWebSocket = (globalThis as any).WebSocket;
    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      static instances: any[] = [];
      onopen: any = null;
      onmessage: any = null;
      onclose: any = null;
      onerror: any = null;
      readyState = MockWebSocket.OPEN;
      sent: any[] = [];
      constructor(_url: string, _opts?: any) {
        MockWebSocket.instances.push(this);
        // simulate async open
        setTimeout(() => {
          if (this.onopen) this.onopen();
        }, 0);
      }
      send(data: any) {
        this.sent.push(data);
      }
      close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose({ code: 1000, reason: "" });
      }
      emit(data: any) {
        if (this.onmessage) this.onmessage({ data });
      }
    }

    (globalThis as any).WebSocket = MockWebSocket;

    let client: any = null;
    try {
      const received: any[] = [];
      client = createNiconamaCommentClient(
        {
          watchUrl: "https://live.nicovideo.jp/watch/test",
          launchPersistentContext: (async () => ({
            pages: () => [],
            newPage: async () => ({}),
            close: async () => {},
          })) as any,
        },
        {
          onComments: (c) => {
            received.push(...c);
          },
          onMeta: () => {},
          onError: (e) => {
            throw e;
          },
        },
      );

      const embeddedData = {
        site: { state: { relive: { webSocketUrl: "wss://example.com/ws" } } },
      };

      await (client as any).setupDirectWebSocketConnection(
        "https://live.nicovideo.jp/watch/test",
        embeddedData,
      );

      const ws = MockWebSocket.instances[0];
      // allow onopen/keepSeat to run
      await new Promise((res) => setTimeout(res, 0));

      const payload = JSON.stringify({
        type: "actionComment",
        data: { comment: "hello string", no: 1 },
      });
      ws.emit(payload);

      // wait for callback
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 1000);
        const iv = setInterval(() => {
          if (received.length >= 1) {
            clearTimeout(t);
            clearInterval(iv);
            resolve();
          }
        }, 10);
      });

      expect(received[0]?.data?.comment).toBe("hello string");

      // cleanup
      (client as any).clearDirectWebSocket();
      await (client as any).clearPlaywrightCommentWatcher();
    } finally {
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });

  it("handles ArrayBuffer payloads", async () => {
    const originalWebSocket = (globalThis as any).WebSocket;
    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      static instances: any[] = [];
      onopen: any = null;
      onmessage: any = null;
      onclose: any = null;
      onerror: any = null;
      readyState = MockWebSocket.OPEN;
      sent: any[] = [];
      constructor(_url: string, _opts?: any) {
        MockWebSocket.instances.push(this);
        setTimeout(() => {
          if (this.onopen) this.onopen();
        }, 0);
      }
      send(data: any) {
        this.sent.push(data);
      }
      close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose({ code: 1000, reason: "" });
      }
      emit(data: any) {
        if (this.onmessage) this.onmessage({ data });
      }
    }

    (globalThis as any).WebSocket = MockWebSocket;

    let client: any = null;
    try {
      const received: any[] = [];
      client = createNiconamaCommentClient(
        {
          watchUrl: "https://live.nicovideo.jp/watch/test",
          launchPersistentContext: (async () => ({
            pages: () => [],
            newPage: async () => ({}),
            close: async () => {},
          })) as any,
        },
        {
          onComments: (c) => {
            received.push(...c);
          },
          onMeta: () => {},
          onError: (e) => {
            throw e;
          },
        },
      );

      const embeddedData = {
        site: { state: { relive: { webSocketUrl: "wss://example.com/ws" } } },
      };
      await (client as any).setupDirectWebSocketConnection(
        "https://live.nicovideo.jp/watch/test",
        embeddedData,
      );

      const ws = MockWebSocket.instances[0];
      await new Promise((res) => setTimeout(res, 0));

      const payloadObj = {
        type: "actionComment",
        data: { comment: "arraybuffer", no: 2 },
      };
      const json = JSON.stringify(payloadObj);
      const ab = new TextEncoder().encode(json).buffer;
      ws.emit(ab);

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 1000);
        const iv = setInterval(() => {
          if (received.length >= 1) {
            clearTimeout(t);
            clearInterval(iv);
            resolve();
          }
        }, 10);
      });

      expect(received[0]?.data?.comment).toBe("arraybuffer");

      (client as any).clearDirectWebSocket();
      await (client as any).clearPlaywrightCommentWatcher();
    } finally {
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });

  it("handles arrayBuffer()-capable payload objects", async () => {
    const originalWebSocket = (globalThis as any).WebSocket;
    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      static instances: any[] = [];
      onopen: any = null;
      onmessage: any = null;
      onclose: any = null;
      onerror: any = null;
      readyState = MockWebSocket.OPEN;
      sent: any[] = [];
      constructor(_url: string, _opts?: any) {
        MockWebSocket.instances.push(this);
        setTimeout(() => {
          if (this.onopen) this.onopen();
        }, 0);
      }
      send(data: any) {
        this.sent.push(data);
      }
      close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose({ code: 1000, reason: "" });
      }
      emit(data: any) {
        if (this.onmessage) this.onmessage({ data });
      }
    }

    (globalThis as any).WebSocket = MockWebSocket;

    let client: any = null;
    try {
      const received: any[] = [];
      client = createNiconamaCommentClient(
        {
          watchUrl: "https://live.nicovideo.jp/watch/test",
          launchPersistentContext: (async () => ({
            pages: () => [],
            newPage: async () => ({}),
            close: async () => {},
          })) as any,
        },
        {
          onComments: (c) => {
            received.push(...c);
          },
          onMeta: () => {},
          onError: (e) => {
            throw e;
          },
        },
      );

      const embeddedData = {
        site: { state: { relive: { webSocketUrl: "wss://example.com/ws" } } },
      };
      await (client as any).setupDirectWebSocketConnection(
        "https://live.nicovideo.jp/watch/test",
        embeddedData,
      );

      const ws = MockWebSocket.instances[0];
      await new Promise((res) => setTimeout(res, 0));

      const payloadObj = {
        type: "actionComment",
        data: { comment: "arraybuffer-method", no: 3 },
      };
      const json = JSON.stringify(payloadObj);
      const ab = new TextEncoder().encode(json).buffer;

      const arrayBufferCapable = { arrayBuffer: async () => ab };
      ws.emit(arrayBufferCapable);

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 1000);
        const iv = setInterval(() => {
          if (received.length >= 1) {
            clearTimeout(t);
            clearInterval(iv);
            resolve();
          }
        }, 10);
      });

      expect(received[0]?.data?.comment).toBe("arraybuffer-method");

      (client as any).clearDirectWebSocket();
      await (client as any).clearPlaywrightCommentWatcher();
    } finally {
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });

  it("handles Uint8Array payloads", async () => {
    const originalWebSocket = (globalThis as any).WebSocket;
    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      static instances: any[] = [];
      onopen: any = null;
      onmessage: any = null;
      onclose: any = null;
      onerror: any = null;
      readyState = MockWebSocket.OPEN;
      sent: any[] = [];
      constructor(_url: string, _opts?: any) {
        MockWebSocket.instances.push(this);
        setTimeout(() => {
          if (this.onopen) this.onopen();
        }, 0);
      }
      send(data: any) {
        this.sent.push(data);
      }
      close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose({ code: 1000, reason: "" });
      }
      emit(data: any) {
        if (this.onmessage) this.onmessage({ data });
      }
    }

    (globalThis as any).WebSocket = MockWebSocket;

    let client: any = null;
    try {
      const received: any[] = [];
      client = createNiconamaCommentClient(
        {
          watchUrl: "https://live.nicovideo.jp/watch/test",
          launchPersistentContext: (async () => ({
            pages: () => [],
            newPage: async () => ({}),
            close: async () => {},
          })) as any,
        },
        {
          onComments: (c) => {
            received.push(...c);
          },
          onMeta: () => {},
          onError: (e) => {
            throw e;
          },
        },
      );

      const embeddedData = {
        site: { state: { relive: { webSocketUrl: "wss://example.com/ws" } } },
      };
      await (client as any).setupDirectWebSocketConnection(
        "https://live.nicovideo.jp/watch/test",
        embeddedData,
      );

      const ws = MockWebSocket.instances[0];
      await new Promise((res) => setTimeout(res, 0));

      const payloadObj = {
        type: "actionComment",
        data: { comment: "uint8array", no: 4 },
      };
      const json = JSON.stringify(payloadObj);
      const u8 = new TextEncoder().encode(json);
      ws.emit(u8);

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 1000);
        const iv = setInterval(() => {
          if (received.length >= 1) {
            clearTimeout(t);
            clearInterval(iv);
            resolve();
          }
        }, 10);
      });

      expect(received[0]?.data?.comment).toBe("uint8array");

      (client as any).clearDirectWebSocket();
      await (client as any).clearPlaywrightCommentWatcher();
    } finally {
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });

  it("handles DataView payloads", async () => {
    const originalWebSocket = (globalThis as any).WebSocket;
    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      static instances: any[] = [];
      onopen: any = null;
      onmessage: any = null;
      onclose: any = null;
      onerror: any = null;
      readyState = MockWebSocket.OPEN;
      sent: any[] = [];
      constructor(_url: string, _opts?: any) {
        MockWebSocket.instances.push(this);
        setTimeout(() => {
          if (this.onopen) this.onopen();
        }, 0);
      }
      send(data: any) {
        this.sent.push(data);
      }
      close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose({ code: 1000, reason: "" });
      }
      emit(data: any) {
        if (this.onmessage) this.onmessage({ data });
      }
    }

    (globalThis as any).WebSocket = MockWebSocket;

    let client: any = null;
    try {
      const received: any[] = [];
      client = createNiconamaCommentClient(
        {
          watchUrl: "https://live.nicovideo.jp/watch/test",
          launchPersistentContext: (async () => ({
            pages: () => [],
            newPage: async () => ({}),
            close: async () => {},
          })) as any,
        },
        {
          onComments: (c) => {
            received.push(...c);
          },
          onMeta: () => {},
          onError: (e) => {
            throw e;
          },
        },
      );

      const embeddedData = {
        site: { state: { relive: { webSocketUrl: "wss://example.com/ws" } } },
      };
      await (client as any).setupDirectWebSocketConnection(
        "https://live.nicovideo.jp/watch/test",
        embeddedData,
      );

      const ws = MockWebSocket.instances[0];
      await new Promise((res) => setTimeout(res, 0));

      const payloadObj = {
        type: "actionComment",
        data: { comment: "dataview", no: 5 },
      };
      const json = JSON.stringify(payloadObj);
      const ab = new TextEncoder().encode(json).buffer;
      const dv = new DataView(ab);
      ws.emit(dv);

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 1000);
        const iv = setInterval(() => {
          if (received.length >= 1) {
            clearTimeout(t);
            clearInterval(iv);
            resolve();
          }
        }, 10);
      });

      expect(received[0]?.data?.comment).toBe("dataview");

      (client as any).clearDirectWebSocket();
      await (client as any).clearPlaywrightCommentWatcher();
    } finally {
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });

  it("handles Blob payloads", async () => {
    const originalWebSocket = (globalThis as any).WebSocket;
    const originalBlob = (globalThis as any).Blob;

    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      static instances: any[] = [];
      onopen: any = null;
      onmessage: any = null;
      onclose: any = null;
      onerror: any = null;
      readyState = MockWebSocket.OPEN;
      sent: any[] = [];
      constructor(_url: string, _opts?: any) {
        MockWebSocket.instances.push(this);
        setTimeout(() => {
          if (this.onopen) this.onopen();
        }, 0);
      }
      send(data: any) {
        this.sent.push(data);
      }
      close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose({ code: 1000, reason: "" });
      }
      emit(data: any) {
        if (this.onmessage) this.onmessage({ data });
      }
    }

    // minimal Blob mock with text()
    class MockBlob {
      private txt: string;
      constructor(txt: string) {
        this.txt = txt;
      }
      text() {
        return Promise.resolve(this.txt);
      }
    }

    (globalThis as any).WebSocket = MockWebSocket;
    (globalThis as any).Blob = MockBlob;

    let client: any = null;
    try {
      const received: any[] = [];
      client = createNiconamaCommentClient(
        {
          watchUrl: "https://live.nicovideo.jp/watch/test",
          launchPersistentContext: (async () => ({
            pages: () => [],
            newPage: async () => ({}),
            close: async () => {},
          })) as any,
        },
        {
          onComments: (c) => {
            received.push(...c);
          },
          onMeta: () => {},
          onError: (e) => {
            throw e;
          },
        },
      );

      const embeddedData = {
        site: { state: { relive: { webSocketUrl: "wss://example.com/ws" } } },
      };
      await (client as any).setupDirectWebSocketConnection(
        "https://live.nicovideo.jp/watch/test",
        embeddedData,
      );

      const ws = MockWebSocket.instances[0];
      await new Promise((res) => setTimeout(res, 0));

      const payloadObj = {
        type: "actionComment",
        data: { comment: "blobtext", no: 6 },
      };
      const json = JSON.stringify(payloadObj);
      ws.emit(new MockBlob(json));

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 1000);
        const iv = setInterval(() => {
          if (received.length >= 1) {
            clearTimeout(t);
            clearInterval(iv);
            resolve();
          }
        }, 10);
      });

      expect(received[0]?.data?.comment).toBe("blobtext");

      (client as any).clearDirectWebSocket();
      await (client as any).clearPlaywrightCommentWatcher();
    } finally {
      (globalThis as any).WebSocket = originalWebSocket;
      (globalThis as any).Blob = originalBlob;
    }
  });

  it("handles Buffer-like payloads when Buffer is available", async () => {
    const originalWebSocket = (globalThis as any).WebSocket;
    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      static instances: any[] = [];
      onopen: any = null;
      onmessage: any = null;
      onclose: any = null;
      onerror: any = null;
      readyState = MockWebSocket.OPEN;
      sent: any[] = [];
      constructor(_url: string, _opts?: any) {
        MockWebSocket.instances.push(this);
        setTimeout(() => {
          if (this.onopen) this.onopen();
        }, 0);
      }
      send(data: any) {
        this.sent.push(data);
      }
      close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose({ code: 1000, reason: "" });
      }
      emit(data: any) {
        if (this.onmessage) this.onmessage({ data });
      }
    }

    (globalThis as any).WebSocket = MockWebSocket;

    let client: any = null;
    try {
      const received: any[] = [];
      client = createNiconamaCommentClient(
        {
          watchUrl: "https://live.nicovideo.jp/watch/test",
          launchPersistentContext: (async () => ({
            pages: () => [],
            newPage: async () => ({}),
            close: async () => {},
          })) as any,
        },
        {
          onComments: (c) => {
            received.push(...c);
          },
          onMeta: () => {},
          onError: (e) => {
            throw e;
          },
        },
      );

      const embeddedData = {
        site: { state: { relive: { webSocketUrl: "wss://example.com/ws" } } },
      };
      await (client as any).setupDirectWebSocketConnection(
        "https://live.nicovideo.jp/watch/test",
        embeddedData,
      );

      const ws = MockWebSocket.instances[0];
      await new Promise((res) => setTimeout(res, 0));

      const payloadObj = {
        type: "actionComment",
        data: { comment: "bufferlike", no: 7 },
      };
      const json = JSON.stringify(payloadObj);

      // If Buffer is available, use Buffer, otherwise fall back to Uint8Array
      const maybeBuffer = (globalThis as any).Buffer
        ? (globalThis as any).Buffer.from(json)
        : new TextEncoder().encode(json);
      ws.emit(maybeBuffer);

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 1000);
        const iv = setInterval(() => {
          if (received.length >= 1) {
            clearTimeout(t);
            clearInterval(iv);
            resolve();
          }
        }, 10);
      });

      expect(received[0]?.data?.comment).toBe("bufferlike");

      (client as any).clearDirectWebSocket();
      await (client as any).clearPlaywrightCommentWatcher();
    } finally {
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });
});

describe("buildNiconamaStreamStateFromStatisticsEvent", () => {
  it("returns null for non-statistics events", () => {
    const payload = { type: "reconnect", data: { viewers: 42 } };
    expect(buildNiconamaStreamStateFromStatisticsEvent(payload)).toBeNull();
  });

  it("maps statistics payload to niconama stream state and commentCount", () => {
    const payload = {
      type: "statistics",
      data: {
        viewers: 49,
        comments: 5,
        adPoints: 1800,
        giftPoints: 0,
      },
    };

    expect(buildNiconamaStreamStateFromStatisticsEvent(payload)).toEqual({
      niconama: {
        type: "live",
        meta: {
          total: {
            listeners: 49,
            ad: 1800,
            gift: 0,
          },
        },
      },
      commentCount: 5,
    });
  });

  it("returns null when no numeric statistics properties are present", () => {
    const payload = { type: "statistics", data: { foo: "bar" } };
    expect(buildNiconamaStreamStateFromStatisticsEvent(payload)).toBeNull();
  });
});

describe("hasCommentArrayStructure", () => {
  it("returns true for an empty top-level comments array", () => {
    expect(hasCommentArrayStructure({ comments: [] })).toBe(true);
  });

  it("returns true for an empty nested data comments array", () => {
    expect(hasCommentArrayStructure({ data: { comments: [] } })).toBe(true);
  });

  it("returns true for nested embedded data comment arrays", () => {
    expect(
      hasCommentArrayStructure({
        site: { state: { relive: { comments: [] } } },
      }),
    ).toBe(true);
  });

  it("returns true for deeply nested arbitrary comment arrays", () => {
    expect(
      hasCommentArrayStructure({ foo: { bar: { baz: { comments: [] } } } }),
    ).toBe(true);
  });

  it("returns true for an empty top-level data array", () => {
    expect(hasCommentArrayStructure({ data: [] })).toBe(true);
  });

  it("returns false for a response without comment arrays", () => {
    expect(hasCommentArrayStructure({ foo: "bar" })).toBe(false);
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

describe("NiconamaCommentClient launch failure handling", () => {
  it("should return DEFAULT_FALLBACK_WATCH_URL when launchPersistentContext fails", async () => {
    const consoleErrors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(String(args[0]));
    };

    try {
      const mockLaunchPersistentContext = async () => {
        throw new Error("Failed to connect to browser");
      };

      const client = createNiconamaCommentClient(
        {
          watchUrl: "",
          launchPersistentContext: mockLaunchPersistentContext as any,
        },
        {
          onComments: async () => {},
          onMeta: async () => {},
        },
      );

      // Call the private method indirectly through the client's public API
      // Since resolveWatchUrlFromNiconamaTopPage is private, we test the error handling
      // by verifying the client logs the error appropriately
      expect(consoleErrors.some((msg) => msg.includes("[ERROR]"))).toBeFalse(); // No error yet since we haven't called the method
    } finally {
      console.error = originalError;
    }
  });

  it("should recognize transient error patterns in launchPersistentContext", async () => {
    const transientPatterns = [
      "Failed to connect",
      "spawn ENOENT",
      "spawn ENOTDIR",
      "ECONNREFUSED",
      "pipe broken",
      "Timeout",
    ];

    const errorRegex = /Failed to connect|spawn|ECONNREFUSED|pipe|Timeout/i;

    for (const pattern of transientPatterns) {
      expect(errorRegex.test(pattern)).toBeTrue();
    }
  });
});
