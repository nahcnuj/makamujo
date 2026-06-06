import { existsSync, mkdirSync, statSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentComment } from "automated-gameplay-transmitter";

import { DEFAULT_PLAYWRIGHT_USER_DATA_DIR, DEFAULT_CHROMIUM_EXECUTABLE_PATH, launchPersistentContext } from "./Browser/chromium";
import {
  ensureUserDataDirExists,
  normalizeHtmlForUrlExtraction,
  extractWatchUrlFromHtml,
  tryParseJson,
  buildNiconamaStreamStateFromStatisticsEvent,
  extractEmbeddedDataFromHtml,
  hasCommentArrayStructure,
  parseAgentCommentsFromResponseBody,
  filterAgentCommentsWithText,
  getCommentTextFromAgentComment,
} from './niconamaCommentClient.helpers';
import {
  addNiconamaPlaywrightInitScript,
  extractBodyTextFromHtml,
  getBodyTextFromPage,
  startPlaywrightPagePolling,
  waitForAnyCommentSelector,
  tryOpenRenderedCommentPanel,
  pollPageComments,
  scanRenderedFrameForComments,
  extractPageComments,
} from './niconamaCommentClient.playwright';



type NiconamaBrowserPageResponse = {
  status: () => number;
  text: () => Promise<string>;
};

type NiconamaBrowserPage = {
  on: (event: string, callback: any) => void;
  goto: (url: string, options?: Record<string, unknown>) => Promise<NiconamaBrowserPageResponse | null>;
  close: () => Promise<void>;
  evaluate: <T>(pageFunction: () => T) => Promise<T>;
  getByText: (text: string) => {
    count: () => Promise<number>;
    first: () => {
      hover: (options?: { timeout?: number }) => Promise<void>;
      waitFor: (options: Record<string, unknown>) => Promise<void>;
      count: () => Promise<number>;
    };
  };
  locator: (selector: string) => {
    first: () => {
      getAttribute: (name: string) => Promise<string | null>;
      count: () => Promise<number>;
    };
  };
  waitFor: (options: Record<string, unknown>) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForLoadState?: (state?: string, options?: Record<string, unknown>) => Promise<void>;
  waitForSelector?: (selector: string, options?: Record<string, unknown>) => Promise<unknown>;
  setDefaultTimeout?: (ms: number) => void;
  screenshot?: (options?: { path?: string }) => Promise<unknown>;
  url: () => string;
  isClosed: () => boolean;
};

type NiconamaBrowserContext = {
  pages: () => NiconamaBrowserPage[];
  newPage: () => Promise<NiconamaBrowserPage>;
  close: () => Promise<void>;
  on?: (event: string, callback: any) => void;
};

type NiconamaLaunchPersistentContext = (userDataDir: string, options?: Record<string, unknown>) => Promise<NiconamaBrowserContext>;

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_WATCH_PAGE_BASE_URL = 'https://live.nicovideo.jp';
const DEFAULT_FALLBACK_WATCH_URL = 'https://live.nicovideo.jp/watch/user/14171889';

export type NiconamaCommentClientOptions = {
  userDataDir?: string;
  executablePath?: string;
  watchUrl?: string;
  pollIntervalMs?: number;
  launchPersistentContext?: NiconamaLaunchPersistentContext;
  // When set to false, the client will not launch Playwright-based
  // fallbacks or enrichment and will rely solely on direct websocket
  // connections and polling APIs. Default: `true`.
  enablePlaywrightFallback?: boolean;
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
  #seenCommentIdentifiers = new Set<string>();
  #directWebSocket: any | null = null;
  #directWebSocketAudienceToken: string | null = null;
  #directWebSocketKeepSeatTimer: ReturnType<typeof setInterval> | null = null;
  #directWebSocketReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #directWebSocketSuppressReconnect = false;
  #directWebSocketQueue: string[] = [];
  #playwrightCommentContext: any | null = null;
  #playwrightCommentPage: any | null = null;
  #playwrightPageCommentPollTimer: ReturnType<typeof setInterval> | null = null;
  #playwrightWatcherTask: Promise<void> | null = null;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #pollCancelResolve: (() => void) | null = null;
  #metricsTimer: ReturnType<typeof setInterval> | null = null;
  #launchPersistentContext: NiconamaLaunchPersistentContext;
  #enablePlaywrightFallback = true;
  #callbacks: NiconamaCommentClientCallbacks;
  // Cap the number of remembered comment identifiers to avoid unbounded
  // memory growth during long-running sessions.
  static readonly MAX_SEEN_COMMENT_IDENTIFIERS = 50_000;

  constructor(options: NiconamaCommentClientOptions, callbacks: NiconamaCommentClientCallbacks) {
    this.#userDataDir = options.userDataDir ?? DEFAULT_PLAYWRIGHT_USER_DATA_DIR;
    this.#watchUrl = options.watchUrl;
    this.#executablePath = options.executablePath ?? DEFAULT_CHROMIUM_EXECUTABLE_PATH;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#launchPersistentContext = options.launchPersistentContext ?? (launchPersistentContext as unknown as NiconamaLaunchPersistentContext);
    this.#enablePlaywrightFallback = options.enablePlaywrightFallback ?? true;
    this.#callbacks = callbacks;
  }

  // Unified delivery helper: call consumer callback and perform maintenance
  // (e.g. trimming the seen identifiers set) to prevent memory/perf degredation.
  private deliverComments(comments: any[]): void {
    // Call consumer callback asynchronously to avoid consumer-induced
    // event-loop blocking while still delivering comments in a timely way.
    try {
      const cb = this.#callbacks.onComments;
      if (typeof cb === 'function') {
        try {
          // Prefer setImmediate-like scheduling; fall back to setTimeout.
          if (typeof (globalThis as any).setImmediate === 'function') {
            (globalThis as any).setImmediate(() => {
              try { cb(comments); } catch (e) { /* swallow */ }
            });
          } else {
            globalThis.setTimeout(() => {
              try { cb(comments); } catch (e) { /* swallow */ }
            }, 0);
          }
        } catch (e) {
          try { cb(comments); } catch (e2) { /* swallow */ }
        }
      }
    } catch (e) {
      // Swallow consumer errors to avoid destabilizing the client.
    }

    // Trim the seen identifiers set to avoid unbounded memory growth.
    try {
      const max = (this.constructor as typeof NiconamaCommentClient).MAX_SEEN_COMMENT_IDENTIFIERS;
      if (this.#seenCommentIdentifiers.size > max) {
        const removeCount = Math.max(0, this.#seenCommentIdentifiers.size - max);
        let removed = 0;
        for (const id of this.#seenCommentIdentifiers) {
          this.#seenCommentIdentifiers.delete(id);
          removed += 1;
          if (removed >= removeCount) break;
        }
      }
    } catch (e) {
      // ignore trimming errors
    }
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

    let embeddedData: unknown | null = null;
    try {
      embeddedData = await this.fetchEmbeddedData(watchUrl);
    } catch (err) {
      this.reportError(err);
      embeddedData = null;
    }
    const hasWebSocketUrl = embeddedData && typeof embeddedData === 'object'
      ? Boolean((embeddedData as any).site?.state?.relive?.webSocketUrl ?? (embeddedData as any).site?.relive?.webSocketUrl ?? (embeddedData as any).relive?.webSocketUrl)
      : false;
    console.debug('[DEBUG] NiconamaCommentClient fetched embedded-data in start', {
      embeddedDataType: embeddedData === null ? 'null' : typeof embeddedData,
      hasWebSocketUrl,
    });
    if (!embeddedData || typeof embeddedData !== 'object') {
      console.warn('[WARN] failed to resolve embedded-data from NicoNico watch page, proceeding with Playwright fallback', { watchUrl });
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

    // At startup, try to deliver any existing comments before opening the
    // live WebSocket so consumers receive pre-existing messages first.
    try {
      const initialComments = parseAgentCommentsFromResponseBody(embeddedData, this.#seenCommentIdentifiers);
      try { console.debug('[DEBUG] startup initialComments count', { count: initialComments.length }); } catch {}
      if (initialComments.length > 0) {
        this.deliverComments(initialComments);
      }
    } catch (err) {
      console.warn('[WARN] error while checking embedded initial comments', err);
    }
    try {
      const polled = await this.fetchCommentsFromPollingApis(embeddedData).catch(() => [] as any[]);
      if (Array.isArray(polled) && polled.length > 0) {
        this.deliverComments(polled);
        console.debug('[DEBUG] delivered comments from polling APIs at startup', { count: polled.length, watchUrl });
      }
    } catch (e) {
      // ignore polling errors at startup
    }

    // Start the direct WebSocket connection to receive live frames and
    // install Playwright watcher in the background to enrich or fallback.
    await this.setupDirectWebSocketConnection(watchUrl, embeddedData);
    try {
      if (this.#enablePlaywrightFallback) {
        this.#playwrightWatcherTask = this.setupPlaywrightCommentWatcher(watchUrl)
          .catch((err) => {
            console.warn('[WARN] setupPlaywrightCommentWatcher failed (background)', err);
          })
          .finally(() => {
            this.#playwrightWatcherTask = null;
          });
      } else {
        console.debug('[DEBUG] Playwright fallback disabled via options (enablePlaywrightFallback=false)');
      }
    } catch (err) {
      console.warn('[WARN] failed to schedule Playwright watcher', err);
    }

    // After watchers are installed, perform an immediate re-scan to catch
    // any comments that arrived between the initial fetch and the watcher
    // installation. If the embedded metadata reports a positive comment
    // count, wait a short, bounded time for the rescan so e2e tests that
    // expect initial comments are less likely to race on background tasks.
    try {
      const reportedCount = (embeddedData && typeof embeddedData === 'object')
        ? (typeof (embeddedData as any).program?.statistics?.commentCount === 'number'
          ? (embeddedData as any).program.statistics.commentCount
          : undefined)
        : undefined;
      if (typeof reportedCount === 'number' && reportedCount > 0) {
        // Wait up to 2s for an immediate rescan to complete and deliver comments.
        await Promise.race([
          this.performImmediateRescan(watchUrl),
          new Promise((res) => setTimeout(res, 2000)),
        ]).catch(() => undefined);
      } else {
        void this.performImmediateRescan(watchUrl).catch(() => undefined);
      }
    } catch (e) {
      // ignore rescan errors
    }
    this.#pollTask = this.pollLoop();
    // Start a lightweight periodic metrics logger to aid in long-run
    // diagnostics (memory + seen identifiers size).
    try {
      if (!this.#metricsTimer) {
        this.#metricsTimer = setInterval(() => {
          try {
            const mem = (typeof process !== 'undefined' && typeof (process as any).memoryUsage === 'function')
              ? (process as any).memoryUsage()
              : null;
            console.debug('[METRICS] memorySnapshot', mem ? { rss: mem.rss, heapUsed: mem.heapUsed } : null, { seen: this.#seenCommentIdentifiers.size });
          } catch (e) {
            // ignore metrics errors
          }
        }, 60_000);
      }
    } catch (e) {
      // ignore
    }
    console.info('[DEBUG] NiconamaCommentClient.start finished');
  }

  public async fetchEmbeddedData(watchUrl?: string): Promise<unknown | null> {
    const targetUrl = watchUrl ?? this.#watchUrl ?? DEFAULT_FALLBACK_WATCH_URL;
    try { console.debug('[DEBUG] fetchEmbeddedData targetUrl ->', targetUrl); } catch {}
    // Prefer the fast static HTML fetch first to avoid launching Playwright
    // unless absolutely necessary (e.g., WAF blocks or rendered-only data).
    let embedded: unknown | null = null;
    try {
      embedded = await this.fetchEmbeddedDataFromPage(targetUrl).catch(() => null);
      try { console.debug('[DEBUG] fetchEmbeddedData fetchEmbeddedDataFromPage ->', embedded ? 'found' : 'not-found'); } catch {}
    } catch (err) {
      this.reportError(err);
      embedded = null;
    }
... (file truncated by read_file tool)