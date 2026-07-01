import {
  buildNiconamaStreamStateFromStatisticsEvent,
  parseAgentCommentsFromResponseBody,
} from "../niconamaCommentClient.helpers";
import { tryParseJson } from "../niconamaCommentClient.helpers";
import type { SeenCommentTracker } from "./SeenCommentTracker";
import type { WatchUrlResolver } from "./WatchUrlResolver";

type DirectWebSocket = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  removeAllListeners?: () => void;
  onmessage: ((event: unknown) => void) | null;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  constructor: { OPEN?: number } & typeof Function;
};

export type WebSocketConnectionCallbacks = {
  onComments: (comments: unknown[]) => void;
  onMeta: (state: unknown) => void;
  onError?: (error: unknown) => void;
};

type WebSocketConnectionOptions = {
  seenTracker: SeenCommentTracker;
  watchUrlResolver: WatchUrlResolver;
  callbacks: WebSocketConnectionCallbacks;
  onShouldRescan?: (watchUrl: string) => void;
};

/**
 * ニコ生のWebSocket接続を管理するクラス。
 *
 * - 接続確立・切断・再接続
 * - keepSeatメッセージの定期送信
 * - 受信メッセージのパース・コールバック呼び出し
 */
export class WebSocketConnection {
  #ws: DirectWebSocket | null = null;
  #audienceToken: string | null = null;
  #keepSeatTimer: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #suppressReconnect = false;
  #messageQueue: string[] = [];
  #stopRequested = false;

  readonly #seenTracker: SeenCommentTracker;
  readonly #watchUrlResolver: WatchUrlResolver;
  readonly #callbacks: WebSocketConnectionCallbacks;
  readonly #onShouldRescan?: (watchUrl: string) => void;

  constructor(options: WebSocketConnectionOptions) {
    this.#seenTracker = options.seenTracker;
    this.#watchUrlResolver = options.watchUrlResolver;
    this.#callbacks = options.callbacks;
    this.#onShouldRescan = options.onShouldRescan;
  }

  get isConnected(): boolean {
    return this.#ws !== null && this.#ws.readyState === 1;
  }

  get hasSocket(): boolean {
    return this.#ws !== null;
  }

  /**
   * 指定URLにWebSocket接続を確立する。
   * URLがwss://ではない場合はembedded-dataからWebSocket URLを取得する。
   */
  async connect(
    webSocketUrl: string,
    watchUrl: string,
    audienceToken?: string | null,
  ): Promise<void> {
    if (this.#ws) return;
    if (this.#stopRequested) return;

    this.#audienceToken = audienceToken ?? null;

    try {
      let WebSocketClass: unknown = (globalThis as Record<string, unknown>)
        .WebSocket;
      if (typeof WebSocketClass !== "function") {
        try {
          const wsMod = await import("ws");
          WebSocketClass = wsMod?.default ?? wsMod?.WebSocket ?? wsMod;
        } catch {
          console.warn(
            "[WARN] WebSocketConnection: WebSocket not available in this runtime",
            { watchUrl },
          );
          return;
        }
      }

      if (typeof WebSocketClass !== "function") {
        console.warn("[WARN] WebSocketConnection: WebSocketClass is not callable");
        return;
      }

      const WebSocketConstructor = WebSocketClass as new (
        url: string,
        options?: unknown,
      ) => DirectWebSocket;

      console.debug(
        "[DEBUG] WebSocketConnection: creating socket",
        webSocketUrl,
      );
      let ws: DirectWebSocket;
      try {
        const headers = {
          Origin: "https://live.nicovideo.jp",
          Referer: watchUrl,
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        };
        try {
          ws = new WebSocketConstructor(webSocketUrl, {
            headers,
            perMessageDeflate: false,
            handshakeTimeout: 30_000,
          } as unknown) as DirectWebSocket;
        } catch {
          try {
            ws = new WebSocketConstructor(webSocketUrl, {
              headers,
            } as unknown) as DirectWebSocket;
          } catch {
            ws = new WebSocketConstructor(webSocketUrl) as DirectWebSocket;
          }
        }
      } catch (err) {
        console.warn(
          "[WARN] WebSocketConnection: failed to construct WebSocket",
          err,
        );
        return;
      }

      this.#ws = ws;
      this.#attachHandlers(ws, webSocketUrl, watchUrl, WebSocketClass);

      this.#keepSeatTimer = setInterval(() => {
        try {
          const wsOpenState = (WebSocketClass as { OPEN?: number }).OPEN;
          if (
            this.#ws &&
            this.#ws.readyState ===
              (typeof wsOpenState === "number" ? wsOpenState : 1)
          ) {
            this.#sendKeepSeat();
          }
        } catch (err) {
          console.warn(
            "[WARN] WebSocketConnection: failed to send keepSeat",
            err,
          );
        }
      }, 10_000);

      console.info(
        "[DEBUG] WebSocketConnection: connection initiated",
        webSocketUrl,
      );
    } catch (err) {
      if (typeof this.#callbacks.onError === "function") {
        this.#callbacks.onError(err);
      }
    }
  }

  /** WebSocket接続を切断・クリーンアップする */
  disconnect(): void {
    if (this.#keepSeatTimer) {
      clearInterval(this.#keepSeatTimer);
      this.#keepSeatTimer = null;
    }
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#audienceToken = null;
    if (!this.#ws) return;

    const ws = this.#ws;
    this.#ws = null;
    this.#messageQueue = [];
    try {
      try {
        ws.onopen = null;
      } catch {}
      try {
        ws.onmessage = null;
      } catch {}
      try {
        ws.onerror = null;
      } catch {}
      try {
        ws.onclose = null;
      } catch {}
      try {
        if (typeof ws.removeAllListeners === "function")
          ws.removeAllListeners();
      } catch {}
      ws.close();
    } catch {}
  }

  /** stop()後は自動再接続しない */
  stop(): void {
    this.#stopRequested = true;
    this.#suppressReconnect = true;
    this.disconnect();
  }

  #attachHandlers(
    ws: DirectWebSocket,
    webSocketUrl: string,
    watchUrl: string,
    WebSocketClass: unknown,
  ): void {
    ws.onopen = () => {
      console.info("[INFO] WebSocketConnection: established", webSocketUrl);
      // キューされたメッセージを送信
      try {
        while (this.#messageQueue.length > 0) {
          const msg = this.#messageQueue.shift();
          if (msg && ws.readyState === ((WebSocketClass as { OPEN?: number }).OPEN ?? 1)) {
            try {
              ws.send(msg);
            } catch (e) {
              console.warn(
                "[WARN] WebSocketConnection: failed to send queued message",
                e,
              );
              break;
            }
          } else {
            break;
          }
        }
      } catch {}
      this.#sendKeepSeat();
    };

    ws.onmessage = (event: unknown) => {
      try {
        const eventRecord =
          typeof event === "object" && event !== null
            ? (event as Record<string, unknown>)
            : null;
        const data = eventRecord?.data;
        const payload = decodeWebSocketData(data);
        if (payload !== null) {
          console.debug("[DEBUG] WebSocketConnection: received message", {
            wsUrl: webSocketUrl,
            payloadLength: payload.length,
          });
          this.#handleMessage(payload, webSocketUrl, watchUrl);
        }
      } catch (err) {
        console.warn(
          "[WARN] WebSocketConnection: failed to handle message",
          err,
        );
      }
    };

    ws.onerror = (event: unknown) => {
      console.warn("[WARN] WebSocketConnection: error", event);
    };

    ws.onclose = (event: unknown) => {
      const closeEvent =
        typeof event === "object" && event !== null
          ? (event as { code?: number; reason?: string })
          : {};
      console.warn(
        "[WARN] WebSocketConnection: closed",
        webSocketUrl,
        closeEvent.code,
        closeEvent.reason,
      );
      if (this.#ws === ws) {
        this.disconnect();
      }
      if (this.#suppressReconnect) {
        this.#suppressReconnect = false;
        return;
      }
      if (!this.#stopRequested && !this.#reconnectTimer) {
        this.#reconnectTimer = globalThis.setTimeout(() => {
          this.#reconnectTimer = null;
          if (!this.#stopRequested) {
            void this.#watchUrlResolver.resolve()
              .then((url) => {
                if (typeof url === "string" && url.length > 0) {
                  // reconnect: 呼び出し元が再接続を管理する
                  console.info(
                    "[INFO] WebSocketConnection: scheduling reconnect",
                    url,
                  );
                }
              })
              .catch(() => undefined);
          }
        }, 5_000);
      }
    };
  }

  #sendKeepSeat(): void {
    const msg: Record<string, string> = { type: "keepSeat" };
    if (this.#audienceToken) {
      msg.audienceToken = this.#audienceToken;
    } else {
      console.warn(
        "[WARN] WebSocketConnection: sending keepSeat without audience token",
      );
    }
    this.#send(msg);
  }

  #send(message: unknown): void {
    try {
      const msg = JSON.stringify(message);
      console.debug("[DEBUG] WebSocketConnection: sending message", message);
      if (this.#ws?.readyState !== 1) {
        this.#messageQueue.push(msg);
        return;
      }
      this.#ws.send(msg);
    } catch (err) {
      console.warn("[WARN] WebSocketConnection: failed to send message", err);
      try {
        this.#messageQueue.push(JSON.stringify(message));
      } catch {}
    }
  }

  #handleMessage(message: string, wsUrl: string, watchUrl: string): void {
    if (!message) {
      console.debug(
        "[DEBUG] WebSocketConnection: empty message received",
        wsUrl,
      );
      return;
    }

    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(message) as Record<string, unknown>;
    } catch {
      // NDJSON対応
      const lines = String(message)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        const parsed = tryParseJson(line);
        if (!parsed) continue;
        const comments = parseAgentCommentsFromResponseBody(
          parsed,
          this.#seenTracker.set,
        );
        if (comments.length > 0) {
          this.#callbacks.onComments(comments);
          console.debug("[DEBUG] WebSocketConnection: NDJSON comment payload", {
            wsUrl,
            count: comments.length,
          });
          return;
        }
      }
      return;
    }

    if (!body || typeof body !== "object") return;

    const eventType = body.type as string | undefined;

    if (eventType === "ping") {
      this.#send({ type: "keepSeat", ...(this.#audienceToken ? { audienceToken: this.#audienceToken } : {}) });
      return;
    }

    switch (eventType) {
      case "statistics": {
        const metaState = buildNiconamaStreamStateFromStatisticsEvent(body);
        if (metaState) {
          this.#callbacks.onMeta(metaState);
        }
        // コメント数が増えた場合は再スキャンをトリガー
        try {
          const rawStats = body.data;
          const stats =
            rawStats && typeof rawStats === "object"
              ? (rawStats as Record<string, unknown>)
              : null;
          if (
            stats &&
            typeof stats.comments === "number" &&
            stats.comments > 0 &&
            this.#onShouldRescan
          ) {
            void this.#watchUrlResolver.resolve()
              .then((url) => {
                if (typeof url === "string" && url.length > 0 && this.#onShouldRescan) {
                  this.#onShouldRescan(url);
                }
              })
              .catch(() => undefined);
          }
        } catch {}
        break;
      }
      case "reconnect": {
        this.#handleReconnect(body, wsUrl);
        return;
      }
      default:
        break;
    }

    const comments = parseAgentCommentsFromResponseBody(
      body,
      this.#seenTracker.set,
      eventType,
    );
    if (comments.length > 0) {
      this.#callbacks.onComments(comments);
      console.debug(
        "[DEBUG] WebSocketConnection: comment payload",
        eventType,
        wsUrl,
        { count: comments.length },
      );
    }
  }

  #handleReconnect(
    body: Record<string, unknown>,
    wsUrl: string,
  ): void {
    try {
      const rawReconnectData = body.data;
      const reconnectData =
        rawReconnectData && typeof rawReconnectData === "object"
          ? (rawReconnectData as Record<string, unknown>)
          : null;
      const newToken = reconnectData?.audienceToken as unknown;
      const waitTimeMs =
        reconnectData &&
        typeof reconnectData.waitTimeSec === "number" &&
        reconnectData.waitTimeSec > 0
          ? reconnectData.waitTimeSec * 1_000
          : 1_000;

      this.#suppressReconnect = true;
      this.disconnect();

      if (typeof newToken === "string" && newToken.length > 0) {
        this.#audienceToken = newToken;
        const reconnectUrl = this.#buildUrlWithAudienceToken(wsUrl, newToken);
        console.info(
          `[INFO] WebSocketConnection: reconnect waitMs:${waitTimeMs} token:${newToken.substring(0, 20)}`,
        );
        if (!this.#stopRequested) {
          this.#reconnectTimer = globalThis.setTimeout(async () => {
            this.#reconnectTimer = null;
            if (!this.#stopRequested) {
              if (reconnectUrl) {
                const resolvedUrl = await this.#watchUrlResolver.resolve();
                if (resolvedUrl) {
                  await this.connect(reconnectUrl, resolvedUrl, newToken);
                }
              }
            }
          }, waitTimeMs + 250);
        }
      } else if (wsUrl.includes("audience_token=")) {
        console.info(
          `[INFO] WebSocketConnection: reconnect waitMs:${waitTimeMs} token:auto-refresh`,
        );
        if (!this.#stopRequested) {
          this.#reconnectTimer = globalThis.setTimeout(async () => {
            this.#reconnectTimer = null;
            if (!this.#stopRequested) {
              const url = await this.#watchUrlResolver.resolve();
              if (typeof url === "string" && url.length > 0) {
                await this.connect(url, url);
              }
            }
          }, waitTimeMs + 250);
        }
      }
    } catch {
      // ignore
    }
  }

  #buildUrlWithAudienceToken(
    webSocketUrl: string,
    audienceToken: string,
  ): string | null {
    try {
      const url = new URL(webSocketUrl);
      url.searchParams.set("audience_token", audienceToken);
      return url.toString();
    } catch {
      return null;
    }
  }
}

/**
 * WebSocketデータを文字列に変換する。
 * string, ArrayBuffer, ArrayBufferView, Blob, arrayBuffer()メソッドを持つオブジェクトに対応。
 * Blobはsyncに処理できないため、この関数はnullを返す（Blob処理は呼び出し元で非同期に行う）。
 */
export const decodeWebSocketData = (data: unknown): string | null => {
  if (typeof data === "string") return data;

  try {
    if (ArrayBuffer.isView(data)) {
      return new TextDecoder().decode(data as ArrayBufferView);
    }
  } catch {}

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  // Blobは非同期なので呼び出し元で処理
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return null;
  }

  if (data && typeof (data as Record<string, unknown>).arrayBuffer === "function") {
    return null; // 非同期なので呼び出し元で処理
  }

  return String(data ?? "");
};

/**
 * WebSocket URLからaudience_tokenを取得する。
 */
export const extractAudienceTokenFromWebSocketUrl = (
  webSocketUrl: string,
): string | null => {
  try {
    const url = new URL(webSocketUrl);
    return url.searchParams.get("audience_token");
  } catch {
    return null;
  }
};
