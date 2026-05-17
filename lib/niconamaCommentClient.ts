import { existsSync, mkdirSync, statSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import type { AgentComment } from "automated-gameplay-transmitter";

const DEFAULT_USER_DATA_DIR = './niconama/.auth/';
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_WATCH_PAGE_BASE_URL = 'https://live.nicovideo.jp/';

/**
 * `userDataDir` が存在しない場合はディレクトリを作成する。
 * パスが存在するがディレクトリでない場合はエラーをスローする。
 */
export const ensureUserDataDirExists = (userDataDir: string): void => {
  if (existsSync(userDataDir)) {
    if (!statSync(userDataDir).isDirectory()) {
      throw new Error(`userDataDir must be a directory: ${userDataDir}`);
    }
    return;
  }

  mkdirSync(userDataDir, { recursive: true });
};

export type NiconamaCommentClientOptions = {
  userDataDir?: string;
  executablePath?: string;
  watchUrl?: string;
  pollIntervalMs?: number;
};

type NiconamaCommentClientCallbacks = {
  onComments: (comments: AgentComment[]) => void;
  onMeta: (state: unknown) => void;
  onError?: (error: unknown) => void;
};

export class NiconamaCommentClient {
  #userDataDir: string;
  #watchUrl?: string;
  #pollIntervalMs: number;
  #running = false;
  #stopRequested = false;
  #pollTask: Promise<void> | null = null;
  #seenCommentSignatures = new Set<string>();
  #directWebSocket: any | null = null;
  #directWebSocketKeepSeatTimer: ReturnType<typeof setInterval> | null = null;
  #callbacks: NiconamaCommentClientCallbacks;

  constructor(options: NiconamaCommentClientOptions, callbacks: NiconamaCommentClientCallbacks) {
    this.#userDataDir = options.userDataDir ?? DEFAULT_USER_DATA_DIR;
    this.#watchUrl = options.watchUrl;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#stopRequested = false;

    console.debug('[DEBUG] NiconamaCommentClient start()', {
      userDataDir: this.#userDataDir,
      watchUrl: this.#watchUrl,
      pollIntervalMs: this.#pollIntervalMs,
    });

    ensureUserDataDirExists(this.#userDataDir);
    const watchUrl = await this.resolveWatchUrl();
    if (!watchUrl) {
      this.reportError(new Error('failed to resolve NicoNico watch URL'));
      return;
    }

    this.#running = true;
    this.#callbacks.onMeta({
      type: 'niconama',
      data: {
        isLive: true,
        title: 'NicoNico Live',
        startTime: Date.now(),
        total: 0,
        points: { gift: 0, ad: 0 },
        url: watchUrl,
      },
    });

    await this.setupDirectWebSocketConnection(watchUrl);
    this.#pollTask = this.pollLoop();
  }

  async stop(): Promise<void> {
    this.#stopRequested = true;
    if (this.#pollTask) {
      await this.#pollTask;
      this.#pollTask = null;
    }
    this.clearDirectWebSocket();
    this.#running = false;
  }

  isRunning(): boolean {
    return this.#running;
  }

  private async resolveWatchUrl(): Promise<string | null> {
    const candidateUrl = this.#watchUrl ?? process.env.NICONAMA_WATCH_URL ?? DEFAULT_WATCH_PAGE_BASE_URL;
    if (/\/watch\//.test(candidateUrl)) {
      return candidateUrl;
    }

    console.debug('[DEBUG] resolveWatchUrl fetching candidate page', candidateUrl);
    try {
      const html = await this.fetchHtml(candidateUrl);
      const match = html.match(/href=["'](\/watch\/(?:lv|user)[^"']+)["']/i);
      if (!match) {
        console.warn('[WARN] failed to resolve watch URL from HTML', candidateUrl);
        return null;
      }
      return new URL(match[1]!, candidateUrl).href;
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; bun)',
      },
    });
    if (!response.ok) {
      throw new Error(`failed to fetch ${url}: ${response.status}`);
    }
    return await response.text();
  }

  private async fetchEmbeddedDataFromPage(watchUrl: string): Promise<unknown | null> {
    try {
      const html = await this.fetchHtml(watchUrl);
      const match = html.match(/<div[^>]+id=["']embedded-data["'][^>]+data-props=["']([^"']+)["'][^>]*>/i);
      if (!match) {
        console.warn('[WARN] embedded-data element not found', watchUrl);
        return null;
      }
      const normalized = match[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      return this.tryParseJson(normalized);
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  private async setupDirectWebSocketConnection(watchUrl: string): Promise<void> {
    if (this.#directWebSocket) return;

    console.debug('[DEBUG] setting up direct websocket connection', watchUrl);
    const embeddedData = await this.fetchEmbeddedDataFromPage(watchUrl);
    if (!embeddedData || typeof embeddedData !== 'object') {
      console.warn('[WARN] failed to parse embedded data from page', watchUrl);
      return;
    }

    const webSocketUrl = (embeddedData as any).site?.state?.relive?.webSocketUrl;
    if (!webSocketUrl || typeof webSocketUrl !== 'string') {
      console.warn('[WARN] direct websocket url not found in embedded data', { embeddedData });
      return;
    }

    try {
      const WebSocketClass = (globalThis as any).WebSocket;
      if (typeof WebSocketClass !== 'function') {
        throw new Error('WebSocket is not available in this runtime');
      }

      console.debug('[DEBUG] direct websocket creating socket', webSocketUrl);
      const ws = new WebSocketClass(webSocketUrl, { headers: { Origin: 'https://live.nicovideo.jp' } });
      this.#directWebSocket = ws;

      ws.onopen = () => {
        console.debug('[DEBUG] direct websocket open', webSocketUrl);
      };

      ws.onmessage = (event: { data: unknown }) => {
        try {
          const payload = typeof event.data === 'string'
            ? event.data
            : event.data instanceof ArrayBuffer
              ? new TextDecoder().decode(event.data)
              : String(event.data);
          console.debug('[DEBUG] direct websocket received message', { wsUrl: webSocketUrl, payloadLength: payload.length });
          this.handleDirectWebSocketMessage(payload, webSocketUrl);
        } catch (err) {
          console.warn('[WARN] failed to handle direct websocket message', err);
        }
      };

      ws.onerror = (event: unknown) => {
        console.warn('[WARN] direct websocket error', event);
      };

      ws.onclose = (event: { code?: number; reason?: string }) => {
        console.warn('[WARN] direct websocket closed', webSocketUrl, event.code, event.reason);
        this.clearDirectWebSocket();
        if (!this.#stopRequested) {
          setTimeout(5_000).then(() => {
            if (!this.#stopRequested) {
              void this.setupDirectWebSocketConnection(watchUrl);
            }
          });
        }
      };

      this.#directWebSocketKeepSeatTimer = setInterval(() => {
        if (this.#directWebSocket && this.#directWebSocket.readyState === WebSocketClass.OPEN) {
          const keepSeatMessage = JSON.stringify({ type: 'keepSeat' });
          console.debug('[DEBUG] direct websocket sending message', keepSeatMessage);
          this.#directWebSocket.send(keepSeatMessage);
        }
      }, 10_000);
    } catch (err) {
      this.reportError(err);
    }
  }

  private clearDirectWebSocket(): void {
    if (this.#directWebSocketKeepSeatTimer) {
      clearInterval(this.#directWebSocketKeepSeatTimer);
      this.#directWebSocketKeepSeatTimer = null;
    }
    if (this.#directWebSocket) {
      try { this.#directWebSocket.close(); } catch { }
      this.#directWebSocket = null;
    }
  }

  private handleDirectWebSocketMessage(message: string, wsUrl: string): void {
    if (!message) {
      console.debug('[DEBUG] direct websocket empty message received', wsUrl);
      return;
    }

    let body: unknown = null;
    try {
      body = JSON.parse(message);
    } catch (err) {
      console.warn('[WARN] direct websocket received non-JSON frame', wsUrl, message.slice(0, 200), err);
      return;
    }

    if (!body || typeof body !== 'object') {
      console.warn('[WARN] direct websocket received invalid frame body', wsUrl, message.slice(0, 200));
      return;
    }

    const eventType = (body as any).type;
    if (eventType === 'ping') {
      this.sendDirectWebSocketMessage({ type: 'pong' });
      return;
    }

    const comments = parseAgentCommentsFromResponseBody(body, this.#seenCommentSignatures);
    if (comments.length > 0) {
      this.#callbacks.onComments(comments);
      if (eventType === 'statistics' || eventType === 'reconnect' || eventType === 'seat' || eventType === 'postkey' || eventType === 'postCommentResult' || eventType === 'error_message') {
        console.warn('[WARN] direct websocket known event type with comment payload', eventType, wsUrl, body);
      }
      return;
    }

    if (eventType === 'statistics' || eventType === 'reconnect' || eventType === 'seat' || eventType === 'postkey' || eventType === 'postCommentResult' || eventType === 'error_message') {
      console.warn('[WARN] direct websocket ignored known event type', eventType, wsUrl, body);
      return;
    }

    if (typeof eventType === 'string') {
      console.warn('[WARN] direct websocket unknown event type', eventType, wsUrl, body);
      return;
    }

    console.warn('[WARN] direct websocket unknown event without type', wsUrl, body);
  }

  private sendDirectWebSocketMessage(message: unknown): void {
    if (!this.#directWebSocket) return;
    try {
      console.debug('[DEBUG] direct websocket sending message', message);
      this.#directWebSocket.send(JSON.stringify(message));
    } catch (err) {
      console.warn('[WARN] failed to send direct websocket message', err);
    }
  }

  private tryParseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async pollLoop(): Promise<void> {
    while (!this.#stopRequested && this.#running) {
      await setTimeout(this.#pollIntervalMs);
      if (this.#stopRequested) break;
      if (!this.#directWebSocket) {
        const watchUrl = await this.resolveWatchUrl();
        if (watchUrl) {
          await this.setupDirectWebSocketConnection(watchUrl);
        }
      }
    }
  }

  private reportError(error: unknown): void {
    if (typeof this.#callbacks.onError === 'function') {
      this.#callbacks.onError(error);
    } else {
      console.warn('[WARN] NiconamaCommentClient error:', error instanceof Error ? error.message : String(error));
    }
  }
}

export const createNiconamaCommentClient = (
  options: NiconamaCommentClientOptions,
  callbacks: NiconamaCommentClientCallbacks,
): NiconamaCommentClient => new NiconamaCommentClient(options, callbacks);

export const hasCommentArrayStructure = (body: unknown): boolean => {
  if (!body || typeof body !== 'object') return false;
  const candidateArrays = [
    (body as any).comments,
    (body as any).chat,
    (body as any).chats,
    (body as any).data?.comments,
    (body as any).data?.chat,
    (body as any).data?.chats,
    (body as any).data,
  ];

  return candidateArrays.some(Array.isArray);
};

export const parseAgentCommentsFromResponseBody = (
  body: unknown,
  seenCommentSignatures: Set<string> = new Set<string>(),
): AgentComment[] => {
  if (!body || typeof body !== 'object') return [];
  const rawComments: unknown[] = [];
  const candidateArrays = [
    (body as any).comments,
    (body as any).chat,
    (body as any).chats,
    (body as any).data?.comments,
    (body as any).data?.chat,
    (body as any).data?.chats,
  ];

  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate)) {
      rawComments.push(...candidate);
    }
  }

  if (rawComments.length === 0 && Array.isArray((body as any).data)) {
    rawComments.push(...(body as any).data);
  }

  const comments: AgentComment[] = [];
  const seenSignatures = seenCommentSignatures;

  for (const raw of rawComments) {
    if (!raw || typeof raw !== 'object') continue;
    const commentText = (raw as any).comment ?? (raw as any).text ?? (raw as any).body ?? (raw as any).message;
    if (typeof commentText !== 'string' || commentText.trim().length === 0) continue;
    const commentData: Record<string, unknown> = {
      comment: commentText,
      no: typeof (raw as any).no === 'number' ? (raw as any).no : typeof (raw as any).num === 'number' ? (raw as any).num : undefined,
      anonymity: Boolean((raw as any).anonymity ?? (raw as any).isAnonymous ?? false),
      hasGift: Boolean((raw as any).hasGift ?? (raw as any).gift ?? false),
      userId: (raw as any).userId ?? (raw as any).user_id ?? undefined,
      origin: raw,
    };
    const signature = `${commentData.no ?? 'none'}|${commentData.userId ?? 'unknown'}|${commentData.comment}`;
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);
    comments.push({ data: commentData });
  }

  return comments;
};
