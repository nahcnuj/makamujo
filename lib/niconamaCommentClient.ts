import { existsSync, mkdirSync, statSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import type { AgentComment } from "automated-gameplay-transmitter";
import { DEFAULT_PLAYWRIGHT_USER_DATA_DIR, DEFAULT_CHROMIUM_EXECUTABLE_PATH, launchPersistentContext } from "./Browser/chromium";

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_WATCH_PAGE_BASE_URL = 'https://live.nicovideo.jp/';
const DEFAULT_FALLBACK_WATCH_URL = 'https://live.nicovideo.jp/watch/user/14171889';

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

export const normalizeHtmlForUrlExtraction = (html: string): string =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x27;/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'");

export const extractWatchUrlFromHtml = (html: string, baseUrl: string): string | null => {
  const normalizedHtml = normalizeHtmlForUrlExtraction(html);
  const patterns = [
    /["'](https?:\/\/(?:ext\.)?live\.nicovideo\.jp\/watch\/(?:lv|user)[^"']+)["']/i,
    /["'](\/watch\/(?:lv|user)[^"']+)["']/i,
    /watchPageUrl[^"']*["']([^"']*\/watch\/(?:lv|user)[^"']*)["']/i,
    /programWatchPageUrl[^"']*["']([^"']*\/watch\/(?:lv|user)[^"']*)["']/i,
    /watchPageUrlAtExtPlayer[^"']*["']([^"']*\/watch\/(?:lv|user)[^"']*)["']/i,
  ] as const;

  for (const pattern of patterns) {
    const match = normalizedHtml.match(pattern);
    if (!match) continue;
    try {
      return new URL(match[1]!, baseUrl).href;
    } catch {
      continue;
    }
  }

  return null;
};

export const tryParseJson = (text: string): unknown | null => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const extractEmbeddedDataFromHtml = (html: string): unknown | null => {
  const match = html.match(/<(?:div|script)[^>]+id=["']embedded-data["'][^>]+data-props=["']([^"']+)["'][^>]*>/i);
  if (!match) {
    return null;
  }

  const jsonText = normalizeHtmlForUrlExtraction(match[1]!);
  return tryParseJson(jsonText);
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
  #executablePath?: string;
  #pollIntervalMs: number;
  #running = false;
  #stopRequested = false;
  #pollTask: Promise<void> | null = null;
  #seenCommentSignatures = new Set<string>();
  #directWebSocket: any | null = null;
  #directWebSocketKeepSeatTimer: ReturnType<typeof setInterval> | null = null;
  #callbacks: NiconamaCommentClientCallbacks;

  constructor(options: NiconamaCommentClientOptions, callbacks: NiconamaCommentClientCallbacks) {
    this.#userDataDir = options.userDataDir ?? DEFAULT_PLAYWRIGHT_USER_DATA_DIR;
    this.#watchUrl = options.watchUrl;
    this.#executablePath = options.executablePath ?? DEFAULT_CHROMIUM_EXECUTABLE_PATH;
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

    const embeddedData = await this.fetchEmbeddedDataFromPage(watchUrl);
    if (!embeddedData || typeof embeddedData !== 'object') {
      this.reportError(new Error(`failed to resolve embedded-data from NicoNico watch page: ${watchUrl}`));
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

    await this.setupDirectWebSocketConnection(watchUrl, embeddedData);
    this.#pollTask = this.pollLoop();
  }

  public async fetchEmbeddedData(watchUrl?: string): Promise<unknown | null> {
    const targetUrl = watchUrl ?? this.#watchUrl ?? DEFAULT_FALLBACK_WATCH_URL;
    return this.fetchEmbeddedDataFromPage(targetUrl);
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

    const normalizedRootUrl = DEFAULT_WATCH_PAGE_BASE_URL.replace(/\/+$/u, '');
    const normalizedCandidateUrl = candidateUrl.replace(/\/+$/u, '');
    if (normalizedCandidateUrl === normalizedRootUrl) {
      const watchUrl = await this.resolveWatchUrlFromNiconamaTopPage();
      if (watchUrl) {
        return watchUrl;
      }
    }

    console.debug('[DEBUG] resolveWatchUrl fetching candidate page', candidateUrl);
    try {
      const html = await this.fetchHtml(candidateUrl);
      const watchUrl = extractWatchUrlFromHtml(html, candidateUrl);
      if (!watchUrl) {
        console.warn('[WARN] failed to resolve watch URL from HTML', candidateUrl);
        console.info('[INFO] falling back to fixed NicoNico watch URL', DEFAULT_FALLBACK_WATCH_URL);
        return DEFAULT_FALLBACK_WATCH_URL;
      }
      return watchUrl;
    } catch (err) {
      this.reportError(err);
      console.info('[INFO] falling back to fixed NicoNico watch URL', DEFAULT_FALLBACK_WATCH_URL);
      return DEFAULT_FALLBACK_WATCH_URL;
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

  private async resolveWatchUrlFromNiconamaTopPage(): Promise<string | null> {
    console.debug('[DEBUG] resolveWatchUrlWithPlaywright opening Niconama top page', DEFAULT_WATCH_PAGE_BASE_URL);
    const context = await launchPersistentContext(this.#userDataDir, {
      executablePath: this.#executablePath,
      headless: true,
      ignoreHTTPSErrors: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(DEFAULT_WATCH_PAGE_BASE_URL, { waitUntil: 'networkidle', timeout: 60_000 });
      const targetLocator = page.getByText('馬可無序');
      if (await targetLocator.count() === 0) {
        console.info('[INFO] 馬可無序 was not present on the top page; falling back to fixed watch URL', DEFAULT_FALLBACK_WATCH_URL);
        return DEFAULT_FALLBACK_WATCH_URL;
      }
      const target = targetLocator.first();
      try {
        await target.waitFor({ state: 'visible', timeout: 15_000 });
        await target.hover({ timeout: 15_000 });
      } catch (hoverErr) {
        console.warn('[WARN] failed to hover target element', hoverErr);
      }
      await page.waitForTimeout(1_500);

      const broadcastLink = page.locator('a:has-text("放送中のページ")').first();
      if (await broadcastLink.count() > 0) {
        const href = await broadcastLink.getAttribute('href');
        if (href) {
          return new URL(href, DEFAULT_WATCH_PAGE_BASE_URL).href;
        }
      }

      console.warn('[WARN] failed to resolve watch URL via Playwright', DEFAULT_WATCH_PAGE_BASE_URL);
      console.info('[INFO] falling back to fixed NicoNico watch URL', DEFAULT_FALLBACK_WATCH_URL);
      return DEFAULT_FALLBACK_WATCH_URL;
    } finally {
      await context.close();
    }
  }

  private async fetchEmbeddedDataFromPage(watchUrl: string): Promise<unknown | null> {
    try {
      const html = await this.fetchHtml(watchUrl);
      const embeddedData = extractEmbeddedDataFromHtml(html);
      if (!embeddedData) {
        console.warn('[WARN] embedded-data element not found', watchUrl);
        return null;
      }
      return embeddedData;
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  private async setupDirectWebSocketConnection(watchUrl: string, embeddedData?: unknown): Promise<void> {
    if (this.#directWebSocket) return;

    console.debug('[DEBUG] setting up direct websocket connection', watchUrl);
    const data = embeddedData ?? await this.fetchEmbeddedDataFromPage(watchUrl);
    if (!data || typeof data !== 'object') {
      console.warn('[WARN] failed to parse embedded data from page', watchUrl);
      return;
    }

    const webSocketUrl = (data as any).site?.state?.relive?.webSocketUrl ?? (data as any).site?.relive?.webSocketUrl;
    if (!webSocketUrl || typeof webSocketUrl !== 'string') {
      console.warn('[WARN] direct websocket url not found in embedded data', { embeddedData: data });
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
        console.info('[INFO] direct websocket established', webSocketUrl);
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
    return tryParseJson(text);
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
