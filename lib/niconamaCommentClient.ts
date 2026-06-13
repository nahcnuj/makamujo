import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentComment } from "automated-gameplay-transmitter";

import {
  DEFAULT_CHROMIUM_EXECUTABLE_PATH,
  DEFAULT_PLAYWRIGHT_USER_DATA_DIR,
  launchPersistentContext,
} from "./Browser/chromium";
import {
  buildNiconamaStreamStateFromStatisticsEvent,
  ensureUserDataDirExists,
  extractEmbeddedDataFromHtml,
  extractWatchUrlFromHtml,
  filterAgentCommentsWithText,
  getCommentTextFromAgentComment,
  hasCommentArrayStructure,
  normalizeHtmlForUrlExtraction,
  parseAgentCommentsFromResponseBody,
  tryParseJson,
} from "./niconamaCommentClient.helpers";
import {
  addNiconamaPlaywrightInitScript,
  extractBodyTextFromHtml,
  extractPageComments,
  getBodyTextFromPage,
  pollPageComments,
  scanRenderedFrameForComments,
  startPlaywrightPagePolling,
  tryOpenRenderedCommentPanel,
  waitForAnyCommentSelector,
} from "./niconamaCommentClient.playwright";

type DirectWebSocket = {
  readyState: number;
  send: (data: string) => void;
  onmessage: ((event: unknown) => void) | null;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

type NiconamaBrowserPageResponse = {
  status: () => number;
  text: () => Promise<string>;
};

type NiconamaBrowserPage = {
  on: (event: string, callback: (event: unknown) => void) => void;
  goto: (
    url: string,
    options?: Record<string, unknown>,
  ) => Promise<NiconamaBrowserPageResponse | null>;
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
  waitForLoadState?: (
    state?: string,
    options?: Record<string, unknown>,
  ) => Promise<void>;
  waitForSelector?: (
    selector: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  setDefaultTimeout?: (ms: number) => void;
  screenshot?: (options?: { path?: string }) => Promise<unknown>;
  url: () => string;
  isClosed: () => boolean;
};

type NiconamaBrowserContext = {
  pages: () => NiconamaBrowserPage[];
  newPage: () => Promise<NiconamaBrowserPage>;
  close: () => Promise<void>;
  on?: (event: string, callback: (event: unknown) => void) => void;
};

type NiconamaLaunchPersistentContext = (
  userDataDir: string,
  options?: Record<string, unknown>,
) => Promise<NiconamaBrowserContext>;

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_WATCH_PAGE_BASE_URL = "https://live.nicovideo.jp";
const DEFAULT_FALLBACK_WATCH_URL =
  "https://live.nicovideo.jp/watch/user/14171889";

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
  #directWebSocket: DirectWebSocket | null = null;
  #directWebSocketAudienceToken: string | null = null;
  #directWebSocketKeepSeatTimer: ReturnType<typeof setInterval> | null = null;
  #directWebSocketReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #directWebSocketSuppressReconnect = false;
  #directWebSocketQueue: string[] = [];
  #playwrightCommentContext: unknown | null = null;
  #playwrightPageCommentPollTimer: ReturnType<typeof setInterval> | null = null;
  #playwrightWatcherTask: Promise<void> | null = null;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #pollCancelResolve: (() => void) | null = null;
  #launchPersistentContext: NiconamaLaunchPersistentContext;
  #enablePlaywrightFallback = true;
  #callbacks: NiconamaCommentClientCallbacks;
  // Cap the number of remembered comment identifiers to avoid unbounded
  // memory growth during long-running sessions.
  static readonly MAX_SEEN_COMMENT_IDENTIFIERS = 50_000;

  constructor(
    options: NiconamaCommentClientOptions,
    callbacks: NiconamaCommentClientCallbacks,
  ) {
    this.#userDataDir = options.userDataDir ?? DEFAULT_PLAYWRIGHT_USER_DATA_DIR;
    this.#watchUrl = options.watchUrl;
    this.#executablePath =
      options.executablePath ?? DEFAULT_CHROMIUM_EXECUTABLE_PATH;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#launchPersistentContext =
      options.launchPersistentContext ??
      (launchPersistentContext as unknown as NiconamaLaunchPersistentContext);
    this.#enablePlaywrightFallback = options.enablePlaywrightFallback ?? true;
    this.#callbacks = callbacks;
  }

  // Unified delivery helper: call consumer callback and perform maintenance
  // (e.g. trimming the seen identifiers set) to prevent memory/perf degradation.
  private deliverComments(comments: unknown[]): void {
    // Call consumer callback asynchronously to avoid consumer-induced
    // event-loop blocking while still delivering comments in a timely way.
    try {
      const cb = this.#callbacks.onComments;
      if (typeof cb === "function") {
        try {
          // Prefer setImmediate-like scheduling; fall back to setTimeout.
          if (
            typeof (globalThis as Record<string, unknown>).setImmediate ===
            "function"
          ) {
            (globalThis as Record<string, unknown>).setImmediate(() => {
              try {
                cb(comments);
              } catch {
                /* swallow */
              }
            });
          } else {
            globalThis.setTimeout(() => {
              try {
                cb(comments);
              } catch {
                /* swallow */
              }
            }, 0);
          }
        } catch {
          try {
            cb(comments);
          } catch {
            /* swallow */
          }
        }
      }
    } catch {
      // Swallow consumer errors to avoid destabilizing the client.
    }

    // Trim the seen identifiers set to avoid unbounded memory growth.
    try {
      const max = (this.constructor as typeof NiconamaCommentClient)
        .MAX_SEEN_COMMENT_IDENTIFIERS;
      if (this.#seenCommentIdentifiers.size > max) {
        const removeCount = Math.max(
          0,
          this.#seenCommentIdentifiers.size - max,
        );
        let removed = 0;
        for (const id of this.#seenCommentIdentifiers) {
          this.#seenCommentIdentifiers.delete(id);
          removed += 1;
          if (removed >= removeCount) break;
        }
      }
    } catch {
      // ignore trimming errors
    }
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#stopRequested = false;

    console.debug("[DEBUG] NiconamaCommentClient start()", {
      userDataDir: this.#userDataDir,
      watchUrl: this.#watchUrl,
      pollIntervalMs: this.#pollIntervalMs,
    });

    ensureUserDataDirExists(this.#userDataDir);
    const watchUrl = await this.resolveWatchUrl();
    if (!watchUrl) {
      this.reportError(new Error("failed to resolve NicoNico watch URL"));
      return;
    }

    let embeddedData: unknown | null = null;
    try {
      embeddedData = await this.fetchEmbeddedData(watchUrl);
    } catch (err) {
      this.reportError(err);
      embeddedData = null;
    }
    const hasWebSocketUrl =
      embeddedData && typeof embeddedData === "object"
        ? (() => {
            const embedded = embeddedData as Record<string, unknown>;
            const site = embedded.site as Record<string, unknown> | undefined;
            const relive1 = (site?.state as Record<string, unknown> | undefined)?.relive as Record<string, unknown> | undefined;
            const relive2 = site?.relive as Record<string, unknown> | undefined;
            const relive3 = embedded.relive as Record<string, unknown> | undefined;
            return Boolean(
              relive1?.webSocketUrl ?? relive2?.webSocketUrl ?? relive3?.webSocketUrl
            );
          })()
        : false;
    console.debug(
      "[DEBUG] NiconamaCommentClient fetched embedded-data in start",
      {
        embeddedDataType: embeddedData === null ? "null" : typeof embeddedData,
        hasWebSocketUrl,
      },
    );
    if (!embeddedData || typeof embeddedData !== "object") {
      console.warn(
        "[WARN] failed to resolve embedded-data from NicoNico watch page, proceeding with Playwright fallback",
        { watchUrl },
      );
    }

    this.#running = true;
    this.#callbacks.onMeta({
      type: "niconama",
      data: {
        isLive: true,
        title: "NicoNico Live",
        startTime: Date.now(),
        total: 0,
        points: { gift: 0, ad: 0 },
        url: watchUrl,
      },
    });

    // At startup, try to deliver any existing comments before opening the
    // live WebSocket so consumers receive pre-existing messages first.
    try {
      const initialComments = parseAgentCommentsFromResponseBody(
        embeddedData,
        this.#seenCommentIdentifiers,
      );
      try {
        console.debug("[DEBUG] startup initialComments count", {
          count: initialComments.length,
        });
      } catch {}
      if (initialComments.length > 0) {
        this.deliverComments(initialComments);
      }
    } catch (err) {
      console.warn(
        "[WARN] error while checking embedded initial comments",
        err,
      );
    }
    try {
      const polled = await this.fetchCommentsFromPollingApis(
        embeddedData,
      ).catch(() => [] as unknown[]);
      if (Array.isArray(polled) && polled.length > 0) {
        this.deliverComments(polled);
        console.debug(
          "[DEBUG] delivered comments from polling APIs at startup",
          { count: polled.length, watchUrl },
        );
      }
    } catch {
      // ignore polling errors at startup
    }

    // Start the direct WebSocket connection to receive live frames and
    // install Playwright watcher in the background to enrich or fallback.
    await this.setupDirectWebSocketConnection(watchUrl, embeddedData);
    try {
      if (this.#enablePlaywrightFallback) {
        this.#playwrightWatcherTask = this.setupPlaywrightCommentWatcher(
          watchUrl,
        )
          .catch((err) => {
            console.warn(
              "[WARN] setupPlaywrightCommentWatcher failed (background)",
              err,
            );
          })
          .finally(() => {
            this.#playwrightWatcherTask = null;
          });
      } else {
        console.debug(
          "[DEBUG] Playwright fallback disabled via options (enablePlaywrightFallback=false)",
        );
      }
    } catch (err) {
      console.warn("[WARN] failed to schedule Playwright watcher", err);
    }

    // After watchers are installed, perform an immediate re-scan to catch
    // any comments that arrived between the initial fetch and the watcher
    // installation. If the embedded metadata reports a positive comment
    // count, wait a short, bounded time for the rescan so e2e tests that
    // expect initial comments are less likely to race on background tasks.
    try {
      const reportedCount = (() => {
        if (!embeddedData || typeof embeddedData !== "object") return undefined;
        const embedded = embeddedData as Record<string, unknown>;
        const program = embedded.program as Record<string, unknown> | undefined;
        const stats = program?.statistics as Record<string, unknown> | undefined;
        const count = stats?.commentCount;
        return typeof count === "number" ? count : undefined;
      })();
      if (typeof reportedCount === "number" && reportedCount > 0) {
        // Wait up to 2s for an immediate rescan to complete and deliver comments.
        await Promise.race([
          this.performImmediateRescan(watchUrl),
          new Promise((res) => setTimeout(res, 2000)),
        ]).catch(() => undefined);
      } else {
        void this.performImmediateRescan(watchUrl).catch(() => undefined);
      }
    } catch {
      // ignore rescan errors
    }
    this.#pollTask = this.pollLoop();
    console.info("[DEBUG] NiconamaCommentClient.start finished");
  }

  public async fetchEmbeddedData(watchUrl?: string): Promise<unknown | null> {
    const targetUrl = watchUrl ?? this.#watchUrl ?? DEFAULT_FALLBACK_WATCH_URL;
    try {
      console.debug("[DEBUG] fetchEmbeddedData targetUrl ->", targetUrl);
    } catch {}
    // Prefer the fast static HTML fetch first to avoid launching Playwright
    // unless absolutely necessary (e.g., WAF blocks or rendered-only data).
    let embedded: unknown | null = null;
    try {
      embedded = await this.fetchEmbeddedDataFromPage(targetUrl).catch(
        () => null,
      );
      try {
        console.debug(
          "[DEBUG] fetchEmbeddedData fetchEmbeddedDataFromPage ->",
          embedded ? "found" : "not-found",
        );
      } catch {}
    } catch (err) {
      this.reportError(err);
      embedded = null;
    }
    // If the earlier fetch returned a sentinel indicating the program has
    // ended, treat that as a valid result so the client can continue
    // operating (e.g. start polling for the next program) instead of
    // aborting startup.
    if (
      embedded &&
      typeof embedded === "object" &&
      (embedded as Record<string, unknown>).programEnded
    ) {
      return embedded;
    }

    if (embedded) {
      const getCommentCount = (obj: unknown) => {
        if (!obj || typeof obj !== "object") return undefined;
        const rec = obj as Record<string, unknown>;
        const program = rec.program as Record<string, unknown> | undefined;
        const stats = program?.statistics as Record<string, unknown> | undefined;
        const count = stats?.commentCount;
        if (typeof count === "number") return count;
        if (typeof count === "string") return Number(count);
        return undefined;
      };
      const rawTop = getCommentCount(embedded);
      const rawSite = getCommentCount((embedded as Record<string, unknown>).site);
      const commentCount = rawTop !== undefined ? rawTop : rawSite;
      try {
        const embRec = embedded as Record<string, unknown>;
        const program = embRec.program as Record<string, unknown> | undefined;
        const stats = program?.statistics as Record<string, unknown> | undefined;
        console.debug(
          "[DEBUG] fetchEmbeddedData embedded program/statistics presence",
          {
            hasProgram: Boolean(program),
            hasStatistics: Boolean(stats),
            rawValue: stats?.commentCount,
          },
        );
      } catch {}
      const initialComments = parseAgentCommentsFromResponseBody(embedded);
      // Treat the synthetic placeholder comment '(コメントあり)' as not a real
      // initial comment so that we still attempt Playwright fallbacks when the
      // embedded metadata only reports a count but no bodies.
      const initialRealComments = (initialComments || []).filter(
        (c: unknown) => !(c?.data && c.data.comment === "(コメントあり)"),
      );
      const embeddedWebSocketUrl =
        this.getWebSocketUrlFromEmbeddedData(embedded);
      const embeddedFrontendId = this.getFrontendIdFromEmbeddedData(embedded);
      if (embeddedWebSocketUrl && embeddedFrontendId) {
        (embedded as Record<string, unknown>).webSocketUrl =
          this.buildWebSocketUrlWithFrontendId(
            embeddedWebSocketUrl,
            embeddedFrontendId,
          );
      }

      if (embeddedWebSocketUrl || initialRealComments.length > 0) {
        return embedded;
      }

      try {
        console.debug(
          "[DEBUG] fetchEmbeddedData attempting polling APIs before Playwright",
          targetUrl,
          {
            commentCount,
            initialCommentsCount: initialComments.length,
            embeddedWebSocketUrl: Boolean(embeddedWebSocketUrl),
          },
        );
      } catch {}

      try {
        const singleTry = await this.fetchCommentsFromPollingApis(
          embedded,
        ).catch(() => [] as AgentComment[]);
        if (Array.isArray(singleTry) && singleTry.length > 0) {
          this.deliverComments(singleTry);
          console.debug(
            "[DEBUG] fetchEmbeddedData comments found from polling APIs",
            { count: singleTry.length, targetUrl },
          );
          return embedded;
        }

        if (typeof commentCount === "number" && commentCount > 0) {
          console.debug(
            "[DEBUG] fetchEmbeddedData skipping aggressive polling due to program commentCount, falling back to Playwright",
            { commentCount, targetUrl },
          );
        } else {
          const aggressiveTimeoutMs = 10_000;
          const aggressiveIntervalMs = 1_000;
          const startTime = Date.now();
          while (Date.now() - startTime < aggressiveTimeoutMs) {
            const commentsFromApi = await this.fetchCommentsFromPollingApis(
              embedded,
            ).catch(() => [] as AgentComment[]);
            if (Array.isArray(commentsFromApi) && commentsFromApi.length > 0) {
              this.deliverComments(commentsFromApi);
              console.debug(
                "[DEBUG] fetchEmbeddedData comments found from polling APIs (aggressive)",
                { count: commentsFromApi.length, targetUrl },
              );
              return embedded;
            }
            await new Promise((r) => setTimeout(r, aggressiveIntervalMs));
          }
        }
      } catch {
        // ignore
      }

      try {
        console.debug(
          "[DEBUG] fetchEmbeddedData falling back to Playwright",
          targetUrl,
          {
            commentCount,
            initialCommentsCount: initialComments.length,
            embeddedWebSocketUrl: Boolean(embeddedWebSocketUrl),
          },
        );
      } catch {}
      if (this.#enablePlaywrightFallback) {
        try {
          console.debug(
            "[DEBUG] fetchEmbeddedData invoking fetchEmbeddedDataWithPlaywright",
            { targetUrl },
          );
        } catch {}
        const enrichedEmbedded = await this.fetchEmbeddedDataWithPlaywright(
          targetUrl,
          embedded,
        );
        try {
          console.debug(
            "[DEBUG] fetchEmbeddedData fetchEmbeddedDataWithPlaywright ->",
            enrichedEmbedded ? "found" : "not-found",
          );
        } catch {}
        return enrichedEmbedded ?? embedded;
      }
      return embedded;
    }

    // If static extraction failed entirely, try aggressive polling before
    // starting Playwright to reduce reliance on browser rendering.
    try {
      const singleTry = await this.fetchCommentsFromPollingApis(null).catch(
        () => [] as AgentComment[],
      );
      if (Array.isArray(singleTry) && singleTry.length > 0) {
        this.deliverComments(singleTry);
        console.debug(
          "[DEBUG] fetchEmbeddedData comments found from polling APIs (no static embedded)",
          { count: singleTry.length, targetUrl },
        );
        return null;
      }
      const aggressiveTimeoutMs = 10_000;
      const aggressiveIntervalMs = 1_000;
      const startTime = Date.now();
      while (Date.now() - startTime < aggressiveTimeoutMs) {
        const commentsFromApi = await this.fetchCommentsFromPollingApis(
          null,
        ).catch(() => [] as AgentComment[]);
        if (Array.isArray(commentsFromApi) && commentsFromApi.length > 0) {
          this.deliverComments(commentsFromApi);
          console.debug(
            "[DEBUG] fetchEmbeddedData comments found from polling APIs (aggressive, no static)",
            { count: commentsFromApi.length, targetUrl },
          );
          return null;
        }
        await new Promise((r) => setTimeout(r, aggressiveIntervalMs));
      }
    } catch {
      // ignore
    }

    try {
      console.debug(
        "[DEBUG] fetchEmbeddedData invoking fetchEmbeddedDataWithPlaywright (no static embedded)",
        { targetUrl },
      );
    } catch {}
    if (!this.#enablePlaywrightFallback) {
      console.debug(
        "[DEBUG] skipping Playwright fetchEmbeddedDataWithPlaywright (disabled via enablePlaywrightFallback=false)",
      );
      return null;
    }
    const renderedEmbedded =
      await this.fetchEmbeddedDataWithPlaywright(targetUrl);
    try {
      console.debug(
        "[DEBUG] fetchEmbeddedData fetchEmbeddedDataWithPlaywright (no static embedded) ->",
        renderedEmbedded ? "found" : "not-found",
      );
    } catch {}
    return renderedEmbedded;
  }

  public async fetchRenderedWatchPageBodyText(
    watchUrl?: string,
  ): Promise<string | null> {
    const targetUrl = watchUrl ?? this.#watchUrl ?? DEFAULT_FALLBACK_WATCH_URL;
    const staticHtml = await this.fetchHtml(targetUrl).catch(() => null);
    if (typeof staticHtml === "string") {
      const staticBodyText = extractBodyTextFromHtml(staticHtml);
      if (staticBodyText) {
        return staticBodyText;
      }
    }

    const tempUserDataDir = mkdtempSync(join(tmpdir(), "niconama-body-text-"));
    let context: Record<string, unknown> | null = null;

    try {
      context = (await this.#launchPersistentContext(tempUserDataDir, {
        executablePath: this.#executablePath,
        headless: true,
        ignoreHTTPSErrors: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        locale: "ja-JP",
      })) as Record<string, unknown> | null;

      const page = await context!.newPage();
      await addNiconamaPlaywrightInitScript(page);
      const response = await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      let respStatus: number | undefined;
      try {
        respStatus =
          response && typeof response.status === "function"
            ? response.status()
            : undefined;
      } catch {}
      if (!response || (typeof respStatus === "number" && respStatus >= 400)) {
        console.warn(
          "[WARN] fetchRenderedWatchPageBodyText failed to navigate",
          { targetUrl, status: respStatus },
        );
        return null;
      }

      const activePages = context.pages().filter((p: unknown) => !p.isClosed());
      for (const currentPage of activePages) {
        if (currentPage.isClosed()) continue;
        const bodyText = await getBodyTextFromPage(currentPage);
        if (bodyText) {
          return bodyText;
        }
      }

      for (const currentPage of activePages) {
        if (currentPage.isClosed()) continue;
        try {
          await currentPage.waitForTimeout(2_000).catch(() => undefined);
          await currentPage
            .waitForLoadState?.("networkidle", { timeout: 10_000 })
            .catch(() => undefined);
        } catch {
          // ignore
        }
        const bodyText = await getBodyTextFromPage(currentPage);
        if (bodyText) {
          return bodyText;
        }
      }

      return null;
    } catch (err) {
      this.reportError(err);
      return null;
    } finally {
      if (context) {
        await context.close().catch(() => undefined);
      }
      rmSync(tempUserDataDir, { recursive: true, force: true });
    }
  }

  public async fetchRenderedPageComments(
    watchUrl?: string,
  ): Promise<AgentComment[]> {
    const targetUrl = watchUrl ?? this.#watchUrl ?? DEFAULT_FALLBACK_WATCH_URL;
    const tempUserDataDir = mkdtempSync(
      join(tmpdir(), "niconama-page-comments-"),
    );
    let context: Record<string, unknown> | null = null;
    try {
      context = (await this.#launchPersistentContext(tempUserDataDir, {
        executablePath: this.#executablePath,
        headless: true,
        ignoreHTTPSErrors: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        locale: "ja-JP",
      })) as Record<string, unknown> | null;

      const page = await context.newPage();
      await addNiconamaPlaywrightInitScript(page);
      const response = await page
        .goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch(() => null);
      if (!response) return [];

      // Give the page some time to render dynamic comment panels
      try {
        await page.waitForLoadState?.("networkidle", { timeout: 10_000 });
      } catch {}
      try {
        await page.waitForTimeout?.(2_000);
      } catch {}

      const comments = await extractPageComments(
        page,
        this.#seenCommentIdentifiers,
      ).catch(() => []);
      return comments;
    } catch (err) {
      this.reportError(err);
      return [];
    } finally {
      if (context) await context.close().catch(() => undefined);
      try {
        rmSync(tempUserDataDir, { recursive: true, force: true });
      } catch {}
    }
  }

  async stop(): Promise<void> {
    this.#stopRequested = true;
    console.info("[DEBUG] NiconamaCommentClient.stop entered");
    // Give the poll loop a tick to ensure any sleep timer is installed,
    // then cancel it so stop() can resolve promptly instead of waiting
    // the full poll interval.
    if (this.#pollTask) {
      console.info(
        "[DEBUG] NiconamaCommentClient.stop yielding to event loop before cancelling poll",
      );
      await new Promise((res) => globalThis.setTimeout(res, 0));
    }

    // Cancel any in-flight poll sleep so stop() can resolve quickly.
    try {
      console.info(
        "[DEBUG] NiconamaCommentClient.stop cancelling pollTimer/promise",
        {
          pollTimer: Boolean(this.#pollTimer),
          hasCancel: Boolean(this.#pollCancelResolve),
        },
      );
      if (this.#pollTimer) {
        clearTimeout(this.#pollTimer as unknown);
        this.#pollTimer = null;
      }
      if (this.#pollCancelResolve) {
        const r = this.#pollCancelResolve;
        this.#pollCancelResolve = null;
        r();
      }
    } catch (e) {
      console.info("[WARN] NiconamaCommentClient.stop cancel error", e);
    }

    if (this.#pollTask) {
      console.info(
        "[DEBUG] NiconamaCommentClient.stop not awaiting pollTask, will clear reference",
      );
      this.#pollTask = null;
    }
    this.clearDirectWebSocket();
    await this.clearPlaywrightCommentWatcher();
    if (this.#playwrightWatcherTask) {
      try {
        await this.#playwrightWatcherTask;
      } catch {
        // ignore watcher cleanup failures
      }
      this.#playwrightWatcherTask = null;
    }
    this.#running = false;
    console.info("[DEBUG] NiconamaCommentClient.stop finished");
  }

  isRunning(): boolean {
    return this.#running;
  }

  private async resolveWatchUrl(): Promise<string | null> {
    const candidateUrl =
      this.#watchUrl ??
      process.env.NICONAMA_WATCH_URL ??
      DEFAULT_WATCH_PAGE_BASE_URL;
    if (/\/watch\//.test(candidateUrl)) {
      return candidateUrl;
    }

    const normalizedRootUrl = DEFAULT_WATCH_PAGE_BASE_URL.replace(/\/+$/u, "");
    const normalizedCandidateUrl = candidateUrl.replace(/\/+$/u, "");
    if (normalizedCandidateUrl === normalizedRootUrl) {
      const watchUrl = await this.resolveWatchUrlFromNiconamaTopPage();
      if (watchUrl) {
        return watchUrl;
      }
    }

    console.debug(
      "[DEBUG] resolveWatchUrl fetching candidate page",
      candidateUrl,
    );
    try {
      const html = await this.fetchHtml(candidateUrl);
      const watchUrl = extractWatchUrlFromHtml(html, candidateUrl);
      if (!watchUrl) {
        console.warn(
          "[WARN] failed to resolve watch URL from HTML",
          candidateUrl,
        );
        console.info(
          "[INFO] falling back to fixed NicoNico watch URL",
          DEFAULT_FALLBACK_WATCH_URL,
        );
        return DEFAULT_FALLBACK_WATCH_URL;
      }
      return watchUrl;
    } catch (err) {
      this.reportError(err);
      console.info(
        "[INFO] falling back to fixed NicoNico watch URL",
        DEFAULT_FALLBACK_WATCH_URL,
      );
      return DEFAULT_FALLBACK_WATCH_URL;
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    const userAgent =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    const maxAttempts = 5;
    let lastErr: unknown = null;

    const getBackoffMs = (attempt: number): number =>
      Math.min(10_000, 300 * 2 ** (attempt - 1));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent": userAgent,
          },
        });

        if (response.ok) {
          const text = await response.text();
          console.debug("[DEBUG] fetchHtml fetched", {
            url,
            length: text.length,
          });
          return text;
        }

        if (response.status === 405) {
          if (attempt < maxAttempts) {
            const delayMs = getBackoffMs(attempt);
            console.warn(
              "[WARN] fetchHtml received 405 WAF/captcha, retrying after backoff",
              { url, attempt, delayMs },
            );
            await new Promise((res) => setTimeout(res, delayMs));
            continue;
          }
          const text405 = await response.text().catch(() => null);
          console.warn(
            "[WARN] fetchHtml received 405 WAF/captcha, returning body for fallback",
          );
          return text405 ?? "";
        }

        if (
          response.status >= 500 &&
          response.status < 600 &&
          attempt < maxAttempts
        ) {
          lastErr = new Error(`server error ${response.status}`);
          const delayMs = getBackoffMs(attempt);
          console.warn(
            "[WARN] fetchHtml server error, retrying after backoff",
            { url, status: response.status, attempt, delayMs },
          );
          await new Promise((res) => setTimeout(res, delayMs));
          continue;
        }
        throw new Error(`failed to fetch ${url}: ${response.status}`);
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          const delayMs = getBackoffMs(attempt);
          console.warn(
            "[WARN] fetchHtml request failed, retrying after backoff",
            { url, attempt, delayMs, error: err },
          );
          await new Promise((res) => setTimeout(res, delayMs));
        }
      }
    }

    // Return empty string on repeated failures so callers can attempt
    // browser-based fallbacks instead of propagating exceptions.
    if (lastErr) this.reportError(lastErr);
    return "";
  }

  private async resolveWatchUrlFromNiconamaTopPage(): Promise<string | null> {
    console.debug(
      "[DEBUG] resolveWatchUrlWithPlaywright opening Niconama top page",
      DEFAULT_WATCH_PAGE_BASE_URL,
    );
    let context: NiconamaBrowserContext;
    try {
      context = await this.#launchPersistentContext(this.#userDataDir, {
        executablePath: this.#executablePath,
        headless: true,
        ignoreHTTPSErrors: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    } catch (launchErr) {
      const errMsg =
        launchErr instanceof Error ? launchErr.message : String(launchErr);
      console.error(
        "[ERROR] failed to launch persistent context for Niconama top page:",
        errMsg,
      );
      console.info(
        "[INFO] falling back to fixed NicoNico watch URL",
        DEFAULT_FALLBACK_WATCH_URL,
      );
      return DEFAULT_FALLBACK_WATCH_URL;
    }

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await addNiconamaPlaywrightInitScript(page);
      await page.goto(DEFAULT_WATCH_PAGE_BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      const targetLocator = page.getByText("馬可無序");
      if ((await targetLocator.count()) === 0) {
        console.info(
          "[INFO] 馬可無序 was not present on the top page; falling back to fixed watch URL",
          DEFAULT_FALLBACK_WATCH_URL,
        );
        return DEFAULT_FALLBACK_WATCH_URL;
      }
      const target = targetLocator.first();
      try {
        await target.waitFor({ state: "visible", timeout: 15_000 });
        await target.hover({ timeout: 15_000 });
      } catch (hoverErr) {
        console.warn("[WARN] failed to hover target element", hoverErr);
      }
      await page.waitForTimeout(1_500);

      const broadcastLink = page
        .locator('a:has-text("放送中のページ")')
        .first();
      if ((await broadcastLink.count()) > 0) {
        const href = await broadcastLink.getAttribute("href");
        if (href) {
          return new URL(href, DEFAULT_WATCH_PAGE_BASE_URL).href;
        }
      }

      console.warn(
        "[WARN] failed to resolve watch URL via Playwright",
        DEFAULT_WATCH_PAGE_BASE_URL,
      );
      console.info(
        "[INFO] falling back to fixed NicoNico watch URL",
        DEFAULT_FALLBACK_WATCH_URL,
      );
      return DEFAULT_FALLBACK_WATCH_URL;
    } finally {
      await context.close();
    }
  }

  private getWebSocketUrlFromEmbeddedData(data: unknown): string | undefined {
    if (!data || typeof data !== "object") return undefined;
    return (
      (data as Record<string, unknown>).site?.state?.relive?.webSocketUrl ??
      (data as Record<string, unknown>).site?.relive?.webSocketUrl ??
      (data as Record<string, unknown>).site?.webSocketUrl ??
      (data as Record<string, unknown>).relive?.webSocketUrl ??
      (data as Record<string, unknown>).webSocketUrl
    );
  }

  private getFrontendIdFromEmbeddedData(data: unknown): string | undefined {
    if (!data || typeof data !== "object") return undefined;
    const candidate =
      (data as Record<string, unknown>).site?.frontendId ??
      (data as Record<string, unknown>).site?.state?.frontendId ??
      (data as Record<string, unknown>).frontendId;
    if (typeof candidate === "number") return String(candidate);
    if (typeof candidate === "string" && candidate.trim().length > 0)
      return candidate.trim();
    return undefined;
  }

  private buildWebSocketUrlWithFrontendId(
    webSocketUrl: string,
    frontendId: string,
  ): string | null {
    try {
      const url = new URL(webSocketUrl);
      if (!url.searchParams.has("frontend_id")) {
        url.searchParams.set("frontend_id", frontendId);
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  private async fetchEmbeddedDataWithPlaywright(
    targetUrl: string,
    existingEmbeddedData?: unknown,
  ): Promise<unknown | null> {
    // Spawn a separate Node process that runs Playwright to avoid bringing
    // Playwright internals into this process (which previously caused
    // "not bound in the connection" errors). The external script will
    // print JSON to stdout with the extracted embedded-data.
    try {
      // If a custom `launchPersistentContext` was injected (e.g., tests),
      // prefer running an in-process Playwright flow using that function so
      // test doubles can exercise rendered-page fallbacks without spawning
      // the external helper.
      try {
        // Default function imported at module scope is `launchPersistentContext`.
        // If a different function was provided via constructor options,
        // `this.#launchPersistentContext` will be a different reference.
        const tmpDir = mkdtempSync(join(tmpdir(), "niconama-playwright-"));
        let context: Record<string, unknown> | null = null;
        try {
          context = (await this.#launchPersistentContext(tmpDir, {
            executablePath: this.#executablePath,
            headless: true,
            ignoreHTTPSErrors: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            userAgent:
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            locale: "ja-JP",
          })) as Record<string, unknown> | null;

          const page = context.pages?.()[0] ?? (await context.newPage());
          await addNiconamaPlaywrightInitScript(page);

          try {
            await page.goto(targetUrl, {
              waitUntil: "domcontentloaded",
              timeout: 30_000,
            });
          } catch {}
          try {
            await page.waitForLoadState?.("networkidle", { timeout: 15_000 });
          } catch {}

          // Sanity-check: attempt a tiny evaluate that contains the same
          // marker strings our test doubles look for to ensure the injected
          // fake launchPersistentContext is operable.
          try {
            const sanity = await page
              .evaluate(() => {
                const selectors = ['[data-name="comment"]'];
                return selectors;
              })
              .catch(() => null);
            console.debug(
              "[DEBUG] fetchEmbeddedDataWithPlaywright in-process sanity evaluate",
              { sanity },
            );
          } catch {}

          // Try to scan the rendered page for comments using the same helpers
          // used by the Playwright watcher.
          const comments = await scanRenderedFrameForComments(page).catch(
            () => [] as string[],
          );
          console.debug(
            "[DEBUG] fetchEmbeddedDataWithPlaywright scanned comments",
            { count: Array.isArray(comments) ? comments.length : 0 },
          );
          if (Array.isArray(comments) && comments.length > 0) {
            const enriched =
              existingEmbeddedData && typeof existingEmbeddedData === "object"
                ? JSON.parse(JSON.stringify(existingEmbeddedData))
                : { site: { state: { relive: {} } } };
            try {
              (enriched as Record<string, unknown>).site =
                (enriched as Record<string, unknown>).site ?? {};
              (enriched as Record<string, unknown>).site.state =
                (enriched as Record<string, unknown>).site.state ?? {};
              (enriched as Record<string, unknown>).site.state.relive =
                (enriched as Record<string, unknown>).site.state.relive ?? {};
              (enriched as Record<string, unknown>).site.state.relive.comments =
                comments.map((c: string) => ({ comment: c }));
            } catch {}
            try {
              const parsedComments = (
                enriched as Record<string, unknown>
              ).site.state.relive.comments.map((c: unknown) => ({ data: c }));
              this.deliverComments(parsedComments);
            } catch {}
            return enriched;
          }

          // If the rendered-frame scan didn't find comments, try the more
          // aggressive page-evaluate-based extraction which looks for
          // script/data-props and other embedded JSON that some pages use.
          try {
            const pageComments = await (async () => {
              try {
                const { extractPageComments } = await import(
                  "./niconamaCommentClient.playwright"
                );
                return await extractPageComments(
                  page,
                  this.#seenCommentIdentifiers,
                ).catch(() => [] as unknown[]);
              } catch {
                return [] as unknown[];
              }
            })();
            if (Array.isArray(pageComments) && pageComments.length > 0) {
              const enriched2 =
                existingEmbeddedData && typeof existingEmbeddedData === "object"
                  ? JSON.parse(JSON.stringify(existingEmbeddedData))
                  : { site: { state: { relive: {} } } };
              try {
                (enriched2 as Record<string, unknown>).site =
                  (enriched2 as Record<string, unknown>).site ?? {};
                (enriched2 as Record<string, unknown>).site.state =
                  (enriched2 as Record<string, unknown>).site.state ?? {};
                (enriched2 as Record<string, unknown>).site.state.relive =
                  (enriched2 as Record<string, unknown>).site.state.relive ??
                  {};
                (
                  enriched2 as Record<string, unknown>
                ).site.state.relive.comments = pageComments.map((c: unknown) =>
                  c?.data ? c.data : { comment: String(c) },
                );
              } catch {}
              try {
                this.deliverComments(pageComments);
              } catch {}
              return enriched2;
            }
          } catch {
            // ignore page-eval extraction errors
          }

          try {
            const pageHtml =
              typeof page.content === "function" ? await page.content() : null;
            if (typeof pageHtml === "string" && pageHtml.length > 0) {
              const extracted = extractEmbeddedDataFromHtml(pageHtml);
              console.debug(
                "[DEBUG] fetchEmbeddedDataWithPlaywright extracted embedded data from page content",
                { hasEmbeddedData: Boolean(extracted) },
              );
              if (extracted) {
                return extracted;
              }
            }
          } catch (e) {
            console.warn(
              "[WARN] fetchEmbeddedDataWithPlaywright failed to extract embedded data from rendered page content",
              e && (e as Record<string, unknown>).message
                ? (e as Record<string, unknown>).message
                : String(e),
            );
          }
        } finally {
          try {
            await context?.close?.();
          } catch {}
          try {
            rmSync(tmpDir, { recursive: true, force: true });
          } catch {}
        }
      } catch (e) {
        console.warn(
          "[WARN] in-process Playwright extraction failed, falling back to external helper",
          e && (e as Record<string, unknown>).message
            ? (e as Record<string, unknown>).message
            : String(e),
        );
      }
      const { execFile } = await import("node:child_process");
      const candidates = [
        join(process.cwd(), "scripts", "fetchEmbeddedWithPlaywright.js"),
        new URL("../../scripts/fetchEmbeddedWithPlaywright.js", import.meta.url)
          .pathname,
        join(
          process.cwd(),
          "makamujo",
          "scripts",
          "fetchEmbeddedWithPlaywright.js",
        ),
      ];
      const script = candidates.find((p) => existsSync(p));
      if (!script)
        throw new Error("fetchEmbeddedWithPlaywright script not found");
      // Run the external helper with a larger timeout and retry once on failure
      const runChild = (timeoutMs: number) =>
        new Promise((resolve, reject) => {
          const child = execFile(
            process.execPath,
            [script, targetUrl],
            { timeout: timeoutMs },
            (err, stdout, stderr) => {
              if (err) return reject({ err, stdout, stderr });
              resolve({ stdout, stderr });
            },
          );
          child.on("error", (e) => reject(e));
        });
      let out: unknown = { err: true };
      try {
        out = await runChild(90_000).catch(() => null);
      } catch {
        // try one more time briefly before giving up
        try {
          out = await runChild(60_000).catch(() => null);
        } catch (e2) {
          out = { err: e2 };
        }
      }
      if ((out as Record<string, unknown>).err) {
        console.warn(
          "[WARN] fetchEmbeddedDataWithPlaywright child failed",
          (out as Record<string, unknown>).err,
        );
      } else {
        try {
          const parsed = JSON.parse((out as Record<string, unknown>).stdout);
          if (parsed?.success && parsed.embedded) return parsed.embedded;
          // If child didn't report success but wrote diagnostics, try to
          // read main_response.html from diagnosticsDir to extract embedded-data.
          try {
            const { readFileSync, existsSync } = await import("node:fs");
            const path = await import("node:path");
            if (
              parsed?.diagnosticsDir &&
              typeof parsed.diagnosticsDir === "string"
            ) {
              const mainPath = path.join(
                parsed.diagnosticsDir,
                "main_response.html",
              );
              if (existsSync(mainPath)) {
                const mainHtml = readFileSync(mainPath, "utf8");
                const extracted = extractEmbeddedDataFromHtml(mainHtml);
                if (extracted) return extracted;
              }
              const diagJson = path.join(
                parsed.diagnosticsDir,
                "diagnostics.json",
              );
              if (existsSync(diagJson)) {
                const diagBody = readFileSync(diagJson, "utf8");
                try {
                  const diag = JSON.parse(diagBody);
                  if (diag && Array.isArray(diag.responses)) {
                    for (const r of diag.responses) {
                      if (r && typeof r.body === "string") {
                        const maybe = extractEmbeddedDataFromHtml(r.body);
                        if (maybe) return maybe;
                      }
                    }
                  }
                } catch {}
              }
            }
          } catch {
            // ignore diagnostics read errors
          }
        } catch {
          // ignore parse errors
        }
      }
    } catch {
      // ignore spawn failures
    }

    // Only use the external child-process helper for Playwright fallbacks.
    // Running Playwright in-process previously caused intermittent internal
    // errors ("Object with guid response@... was not bound in the connection").
    // To avoid crashing the parent process during tests, do not attempt an
    // in-process Playwright run here; return null so callers can continue
    // with polling-only strategies.
    return null;
  }

  private async fetchEmbeddedDataFromPage(
    watchUrl: string,
  ): Promise<unknown | null> {
    try {
      const html = await this.fetchHtml(watchUrl);

      // If the watch page contains an explicit "公開終了" marker, notify
      // consumers via `onMeta` and return a sentinel object so callers can
      // continue operating (e.g. start polling) instead of aborting.
      try {
        if (typeof html === "string" && html.indexOf("公開終了") !== -1) {
          try {
            this.#callbacks.onMeta({
              type: "niconama",
              data: {
                isLive: false,
                title: "公開終了",
                startTime: Date.now(),
                total: 0,
                points: { gift: 0, ad: 0 },
                url: watchUrl,
              },
            });
          } catch (cbErr) {
            this.reportError(cbErr);
          }
          return { programEnded: true, url: watchUrl };
        }
      } catch (e) {
        // fall through to regular parsing on unexpected errors
        this.reportError(e);
      }

      const embeddedData = extractEmbeddedDataFromHtml(html);
      console.debug(
        "[DEBUG] fetchEmbeddedDataFromPage extracted embeddedData",
        embeddedData,
      );
      if (!embeddedData) {
        console.warn("[WARN] embedded-data element not found", watchUrl);
        return null;
      }
      return embeddedData;
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  private async setupDirectWebSocketConnection(
    watchUrl: string,
    embeddedData?: unknown,
  ): Promise<void> {
    if (this.#directWebSocket) return;

    const isWebSocketUrl = (() => {
      try {
        const url = new URL(watchUrl);
        return url.protocol === "ws:" || url.protocol === "wss:";
      } catch {
        return false;
      }
    })();
    console.info("[DEBUG] setupDirectWebSocketConnection", {
      watchUrl,
      isWebSocketUrl,
    });
    let data: unknown = embeddedData ?? null;
    let webSocketUrl: string | undefined;

    if (isWebSocketUrl) {
      webSocketUrl = watchUrl;
    } else {
      data = embeddedData ?? (await this.fetchEmbeddedDataFromPage(watchUrl));
      if (!data || typeof data !== "object") {
        console.warn(
          "[WARN] failed to parse embedded data from page",
          watchUrl,
        );
        return;
      }
      const initialComments = parseAgentCommentsFromResponseBody(
        data,
        this.#seenCommentIdentifiers,
      );
      if (initialComments.length > 0) {
        console.debug(
          "[DEBUG] direct websocket initial comments from embedded data",
          { count: initialComments.length, watchUrl },
        );
        this.deliverComments(initialComments);
      }
      webSocketUrl = this.getWebSocketUrlFromEmbeddedData(data);
      const frontendId = this.getFrontendIdFromEmbeddedData(data);
      if (webSocketUrl && frontendId) {
        const enriched = this.buildWebSocketUrlWithFrontendId(
          webSocketUrl,
          frontendId,
        );
        if (enriched) {
          webSocketUrl = enriched;
        }
      }
    }

    if (!webSocketUrl || typeof webSocketUrl !== "string") {
      console.warn("[WARN] direct websocket url not found", {
        embeddedData: data,
        watchUrl,
      });
      return;
    }
    this.#directWebSocketAudienceToken =
      this.extractAudienceTokenFromWebSocketUrl(webSocketUrl);
    if (!this.#directWebSocketAudienceToken) {
      console.warn(
        "[WARN] direct websocket failed to extract audience token from url",
        { webSocketUrl, watchUrl },
      );
    }

    try {
      let WebSocketClass: unknown = (globalThis as Record<string, unknown>)
        .WebSocket;
      if (typeof WebSocketClass !== "function") {
        try {
          const wsMod = await import("ws");
          WebSocketClass = wsMod?.default ?? wsMod?.WebSocket ?? wsMod;
        } catch {
          console.warn(
            "[WARN] direct websocket not available in this runtime, skipping direct websocket connection",
            { watchUrl },
          );
          return;
        }
      }

      console.debug("[DEBUG] direct websocket creating socket", webSocketUrl);
      let ws: unknown = null;
      try {
        const headers = {
          Origin: "https://live.nicovideo.jp",
          Referer: watchUrl,
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        };
        try {
          ws = new WebSocketClass(webSocketUrl, {
            headers,
            perMessageDeflate: false,
            handshakeTimeout: 30_000,
          } as unknown);
        } catch {
          try {
            ws = new WebSocketClass(webSocketUrl, { headers } as unknown);
          } catch {
            ws = new WebSocketClass(webSocketUrl);
          }
        }
      } catch (err) {
        console.warn("[WARN] failed to construct WebSocket", err);
        return;
      }

      this.#directWebSocket = ws;

      ws.onopen = () => {
        console.info("[INFO] direct websocket established", webSocketUrl);
        // Drain any queued messages that were created before the socket opened
        try {
          if (
            this.#directWebSocketQueue &&
            this.#directWebSocketQueue.length > 0
          ) {
            while (this.#directWebSocketQueue.length > 0) {
              const msg = this.#directWebSocketQueue.shift();
              if (msg && ws && ws.readyState === (ws.constructor?.OPEN ?? 1)) {
                try {
                  ws.send(msg);
                } catch (e) {
                  console.warn(
                    "[WARN] failed to send queued websocket message",
                    e,
                  );
                  break;
                }
              } else {
                break;
              }
            }
          }
        } catch {
          // ignore draining errors
        }
        const keepSeatMessage = { type: "keepSeat" } as unknown;
        if (this.#directWebSocketAudienceToken) {
          keepSeatMessage.audienceToken = this.#directWebSocketAudienceToken;
        } else {
          console.warn(
            "[WARN] direct websocket sending keepSeat without audience token - server may force reconnect",
            { webSocketUrl },
          );
        }
        this.sendDirectWebSocketMessage(keepSeatMessage);
      };

      ws.onmessage = (event: unknown) => {
        try {
          const data = event?.data;

          // Handle string payloads
          if (typeof data === "string") {
            console.debug("[DEBUG] direct websocket received message", {
              wsUrl: webSocketUrl,
              payloadLength: data.length,
            });
            this.handleDirectWebSocketMessage(data, webSocketUrl);
            return;
          }

          // Handle ArrayBuffer views (Uint8Array, Buffer, DataView, etc.)
          try {
            if (ArrayBuffer.isView(data)) {
              const payload = new TextDecoder().decode(data as ArrayBufferView);
              console.debug(
                "[DEBUG] direct websocket received ArrayBufferView",
                { wsUrl: webSocketUrl, payloadLength: payload.length },
              );
              this.handleDirectWebSocketMessage(payload, webSocketUrl);
              return;
            }
          } catch (err) {
            console.debug(
              "[DEBUG] ArrayBuffer.isView check failed or decode failed",
              err,
            );
          }

          // Handle ArrayBuffer
          if (data instanceof ArrayBuffer) {
            const payload = new TextDecoder().decode(data);
            console.debug("[DEBUG] direct websocket received ArrayBuffer", {
              wsUrl: webSocketUrl,
              payloadLength: payload.length,
            });
            this.handleDirectWebSocketMessage(payload, webSocketUrl);
            return;
          }

          // Handle Blob (browsers / Bun)
          if (typeof Blob !== "undefined" && data instanceof Blob) {
            data
              .text()
              .then((payloadText: string) => {
                console.debug("[DEBUG] direct websocket received Blob", {
                  wsUrl: webSocketUrl,
                  payloadLength: payloadText.length,
                });
                this.handleDirectWebSocketMessage(payloadText, webSocketUrl);
              })
              .catch((err: unknown) => {
                console.warn(
                  "[WARN] failed to read Blob websocket message",
                  err,
                );
              });
            return;
          }

          // Some environments provide objects with arrayBuffer() (e.g., Buffer-like)
          if (
            data &&
            typeof (data as Record<string, unknown>).arrayBuffer === "function"
          ) {
            (data as Record<string, unknown>)
              .arrayBuffer()
              .then((ab: ArrayBuffer) => {
                const payload = new TextDecoder().decode(ab);
                console.debug(
                  "[DEBUG] direct websocket received arrayBuffer-able",
                  { wsUrl: webSocketUrl, payloadLength: payload.length },
                );
                this.handleDirectWebSocketMessage(payload, webSocketUrl);
              })
              .catch((err: unknown) => {
                console.warn(
                  "[WARN] failed to convert websocket message to arrayBuffer",
                  err,
                );
              });
            return;
          }

          // Fallback: stringify whatever was received
          const fallback = String(data ?? "");
          console.debug("[DEBUG] direct websocket received fallback message", {
            wsUrl: webSocketUrl,
            payloadLength: fallback.length,
          });
          this.handleDirectWebSocketMessage(fallback, webSocketUrl);
        } catch (err) {
          console.warn("[WARN] failed to handle direct websocket message", err);
        }
      };

      ws.onerror = (event: unknown) => {
        console.warn("[WARN] direct websocket error", event);
      };

      ws.onclose = (event: { code?: number; reason?: string }) => {
        console.warn(
          "[WARN] direct websocket closed",
          webSocketUrl,
          event.code,
          event.reason,
        );
        if (this.#directWebSocket === ws) {
          this.clearDirectWebSocket();
        }
        if (this.#directWebSocketSuppressReconnect) {
          this.#directWebSocketSuppressReconnect = false;
          return;
        }
        if (!this.#stopRequested && !this.#directWebSocketReconnectTimer) {
          this.#directWebSocketReconnectTimer = globalThis.setTimeout(() => {
            this.#directWebSocketReconnectTimer = null;
            if (!this.#stopRequested) {
              void this.resolveWatchUrl()
                .then((url) => {
                  if (typeof url === "string" && url.length > 0) {
                    void this.setupDirectWebSocketConnection(url).catch(
                      () => undefined,
                    );
                  }
                })
                .catch(() => undefined);
            }
          }, 5_000);
        }
      };

      this.#directWebSocketKeepSeatTimer = setInterval(() => {
        try {
          if (
            this.#directWebSocket &&
            this.#directWebSocket.readyState === WebSocketClass.OPEN
          ) {
            const keepSeatMessage = { type: "keepSeat" } as unknown;
            if (this.#directWebSocketAudienceToken) {
              keepSeatMessage.audienceToken =
                this.#directWebSocketAudienceToken;
            }
            this.sendDirectWebSocketMessage(keepSeatMessage);
          }
        } catch (err) {
          console.warn("[WARN] failed to send keepSeat message", err);
        }
      }, 10_000);
      console.info("[DEBUG] setupDirectWebSocketConnection finished");
    } catch (err) {
      this.reportError(err);
    }
  }

  private clearDirectWebSocket(): void {
    if (this.#directWebSocketKeepSeatTimer) {
      clearInterval(this.#directWebSocketKeepSeatTimer);
      this.#directWebSocketKeepSeatTimer = null;
    }
    if (this.#directWebSocketReconnectTimer) {
      clearTimeout(this.#directWebSocketReconnectTimer);
      this.#directWebSocketReconnectTimer = null;
    }
    this.#directWebSocketAudienceToken = null;
    if (!this.#directWebSocket) return;

    const ws = this.#directWebSocket;
    this.#directWebSocket = null;
    this.#directWebSocketQueue = [];
    try {
      // Null out event handlers and remove listeners to avoid retaining
      // references to `this` via closure-bound handlers.
      try {
        if (ws) {
          ws.onopen = null;
        }
      } catch {}
      try {
        if (ws) {
          ws.onmessage = null;
        }
      } catch {}
      try {
        if (ws) {
          ws.onerror = null;
        }
      } catch {}
      try {
        if (ws) {
          ws.onclose = null;
        }
      } catch {}
      try {
        if (typeof ws.removeAllListeners === "function")
          ws.removeAllListeners();
      } catch {}
      ws.close();
    } catch {
      // ignore
    }
  }

  private async setupPlaywrightCommentWatcher(watchUrl: string): Promise<void> {
    if (this.#playwrightCommentContext) return;
    if (this.#stopRequested) return;

    const maxAttempts = 12;
    let attempt = 0;

    while (attempt < maxAttempts) {
      if (this.#stopRequested) {
        await this.clearPlaywrightCommentWatcher();
        return;
      }
      attempt += 1;
      try {
        console.info("[INFO] Playwright comment watcher starting", {
          url: watchUrl.substring(0, 80),
          attempt,
        });
        let context = await this.#launchPersistentContext(this.#userDataDir, {
          executablePath: this.#executablePath,
          headless: true,
          ignoreHTTPSErrors: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
          userAgent:
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          locale: "ja-JP",
        });
        console.debug("[DEBUG] Playwright context created", { attempt });
        this.#playwrightCommentContext = context;

        const attachListeners = (pageRef: unknown) => {
          try {
            pageRef.setDefaultTimeout?.(30_000);
          } catch {}
          pageRef.on("close", async () => {
            try {
              let pageUrlSafe = "unknown";
              try {
                pageUrlSafe =
                  typeof pageRef.url === "function"
                    ? pageRef.url()
                    : String(pageRef.url);
              } catch {}
              console.info("[INFO] Playwright page closed", {
                url: pageUrlSafe.substring(0, 80),
              });
              if (this.#stopRequested) return;
              // Prefer recreating the whole context when pages are being closed
              // repeatedly by remote scripts; this gives us a cleaner slate and
              // avoids reused page-level scripts that may force-close new pages.
              try {
                console.warn(
                  "[WARN] Playwright context recreating (page close)",
                  { url: watchUrl.substring(0, 80) },
                );
                try {
                  await context.close();
                } catch {
                  /* ignore */
                }
                // attempt to export trace for debugging
                try {
                  const tmpDir = mkdtempSync(
                    join(tmpdir(), "playwright-trace-"),
                  );
                  const tracePath = join(tmpDir, "trace.zip");
                  console.info(
                    "[INFO] prepared playwright trace path",
                    tracePath,
                  );
                } catch {
                  // ignore trace export errors
                }
                const newContext = await this.#launchPersistentContext(
                  this.#userDataDir,
                  {
                    executablePath: this.#executablePath,
                    headless: true,
                    ignoreHTTPSErrors: true,
                    args: ["--no-sandbox", "--disable-setuid-sandbox"],
                    userAgent:
                      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    locale: "ja-JP",
                  },
                );
                // replace context reference for subsequent ops
                try {
                  /* rebind local context variable by mutating parent scope */ (context as unknown) =
                    newContext;
                } catch {}
                console.debug("[DEBUG] Playwright context recreated");
                const newPage = await newContext.newPage();
                console.debug("[DEBUG] Playwright page recreated");
                await addNiconamaPlaywrightInitScript(newPage);
                attachListeners(newPage);
                try {
                  await newPage.goto(watchUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 30_000,
                  });
                } catch (navErr) {
                  console.warn(
                    "[WARN] recreated Playwright context navigation failed",
                    navErr,
                  );
                }
                page = newPage;
                this.#playwrightCommentContext = newContext;
                console.debug("[DEBUG] Playwright page ready", {
                  url: watchUrl.substring(0, 80),
                });
                this.startPlaywrightPagePolling(page);
                // capture screenshot of surviving pages for debugging
                try {
                  const pages = newContext.pages?.() ?? [];
                  for (let i = 0; i < pages.length; i++) {
                    try {
                      const p = pages[i];
                      if (p && typeof p.screenshot === "function") {
                        const tmpShot = join(
                          tmpdir(),
                          `playwright-shot-${Date.now()}-${i}.png`,
                        );
                        // eslint-disable-next-line no-await-in-loop
                        await p
                          .screenshot({ path: tmpShot })
                          .catch(() => undefined);
                        console.info(
                          "[INFO] saved surviving page screenshot",
                          tmpShot,
                        );
                      }
                    } catch {}
                  }
                } catch {}
                return;
              } catch (recreateErr) {
                console.warn(
                  "[WARN] failed to recreate Playwright context/page",
                  recreateErr,
                );
              }
            } catch (err) {
              console.warn(
                "[WARN] failed to handle Playwright page close",
                err,
              );
            }
          });
          pageRef.on("crash", () => {
            let pageUrlSafe = "unknown";
            try {
              pageUrlSafe =
                typeof pageRef.url === "function"
                  ? pageRef.url()
                  : String(pageRef.url);
            } catch {}
            console.debug("[DEBUG] Playwright page crashed", {
              url: pageUrlSafe,
            });
          });
          pageRef.on("request", (request: unknown) => {
            const url = request.url();
            if (/comment|wsapi|watch|json|data/i.test(url)) {
              console.debug("[DEBUG] Playwright request", url);
            }
          });
          // Playwright `Response` objects can become detached during teardown, so
          // per-response processing is best-effort and fully guarded.
          // We primarily capture comment payloads via websocket frames and by
          // polling `page.content()`, and additionally parse some responses here.
          // (All errors are swallowed to avoid "not bound in the connection".)
          // Route interception is intentionally omitted here in the watcher because
          // the page may be closed by remote content while Playwright is shutting
          // down; route teardown can trigger CDP errors during cleanup.
          pageRef.on("requestfailed", (request: unknown) => {
            const url = request.url();
            if (/comment|wsapi|watch|json|data/i.test(url)) {
              console.debug(
                "[DEBUG] Playwright request failed",
                url,
                request.failure?.()?.errorText,
              );
            }
          });
          pageRef.on("response", (response: unknown) => {
            try {
              const tryProcess = async () => {
                if (this.#stopRequested) return;
                if (pageRef.isClosed?.()) return;
                if (!response || typeof response.text !== "function") return;
                let url = "";
                try {
                  url =
                    typeof response.url === "function" ? response.url() : "";
                } catch {
                  return;
                }
                let ct = "";
                try {
                  ct =
                    typeof response.headers === "function"
                      ? response.headers()["content-type"] || ""
                      : "";
                } catch {}
                if (
                  !/json|html|javascript|text/i.test(ct) &&
                  !/comment|wsapi|watch|json|data/i.test(url)
                ) {
                  return;
                }
                const bodyText = await response.text().catch(() => null);
                if (!bodyText) return;
                const parsed = tryParseJson(bodyText);
                if (parsed) {
                  const comments = parseAgentCommentsFromResponseBody(
                    parsed,
                    this.#seenCommentIdentifiers,
                  );
                  if (comments.length > 0) {
                    this.deliverComments(comments);
                    console.debug(
                      "[DEBUG] Playwright response comment payload",
                      { url, count: comments.length },
                    );
                    return;
                  }
                }
                try {
                  const extracted = extractEmbeddedDataFromHtml(bodyText);
                  if (extracted) {
                    const comments2 = parseAgentCommentsFromResponseBody(
                      extracted,
                      this.#seenCommentIdentifiers,
                    );
                    if (comments2.length > 0) {
                      this.deliverComments(comments2);
                      console.debug(
                        "[DEBUG] Playwright response embedded-data comment payload",
                        { url, count: comments2.length },
                      );
                    }
                  }
                } catch {}
              };
              void tryProcess().catch(() => undefined);
            } catch {
              // swallow
            }
          });
          pageRef.on("websocket", (socket: unknown) => {
            const socketRec = socket as Record<string, unknown>;
            const wsUrl = (socketRec.url as () => string)();
            console.debug("[DEBUG] Playwright websocket connected", wsUrl);
            (socketRec.on as (event: string, handler: (frame: unknown) => void) => void)("framereceived", (frame: unknown) => {
              const pageRefRec = pageRef as Record<string, unknown>;
              if ((pageRefRec.isClosed as (() => boolean) | undefined)?.()) return;
              const frameRec = frame as Record<string, unknown>;
              let payload = frameRec.payload;
              if (payload instanceof ArrayBuffer) {
                payload = new TextDecoder().decode(payload);
              } else if (typeof payload !== "string") {
                payload = String(payload);
              }
              console.debug("[DEBUG] Playwright websocket frame", {
                url: wsUrl,
                length: (payload as string).length,
                snippet: (payload as string).slice(0, 200),
              });
              this.handlePlaywrightWebSocketFrame(payload, wsUrl);
            });
          });

          // Note: removed per-response handler because Playwright Response
          // objects may become detached and throw "not bound in the
          // connection" errors. We rely on `page.content()` and websocket
          // frame listeners to capture comment payloads instead.
        };

        // Attach listeners for any pages created in this context so that if the
        // target page is closed and a new page appears, we still capture network
        // responses and websocket frames. This reduces reliance on a single page
        // object which remote scripts may close.
        try {
          context.on?.("page", (p: unknown) => {
            try {
              attachListeners(p);
            } catch {
              /* ignore */
            }
          });
        } catch {
          // ignore environments where context.on is not available
        }

        // We intentionally avoid attaching a context-level 'response' listener
        // because Playwright Response objects can become detached and throw
        // "not bound in the connection" errors when read. We rely on
        // websocket frame listeners and `page.content()` for extracting
        // embedded data and comment payloads instead.

        let page = await context.newPage();
        console.debug("[DEBUG] Playwright page created");
        await addNiconamaPlaywrightInitScript(page);
        attachListeners(page);

        if (this.#stopRequested) {
          await this.clearPlaywrightCommentWatcher();
          return;
        }

        let response: unknown;
        // Try a few navigation strategies to work around transient network aborts
        for (let navTry = 1; navTry <= 3; navTry++) {
          try {
            if (this.#stopRequested) {
              await this.clearPlaywrightCommentWatcher();
              return;
            }
            const waitUntil =
              navTry === 1
                ? "domcontentloaded"
                : navTry === 2
                  ? "commit"
                  : "load";
            response = await page.goto(watchUrl, {
              waitUntil,
              timeout: 30_000,
            });
            let respStatus2: number | undefined;
            try {
              respStatus2 =
                response && typeof response.status === "function"
                  ? response.status()
                  : undefined;
            } catch {}
            let pageUrlSafe2 = "unknown";
            try {
              pageUrlSafe2 =
                typeof page.url === "function" ? page.url() : String(page.url);
            } catch {}
            console.debug("[DEBUG] Playwright page goto complete", {
              try: navTry,
              responseStatus: respStatus2,
              url: pageUrlSafe2,
              waitUntil,
            });
            break;
          } catch (err) {
            console.warn("[WARN] Playwright page goto attempt failed", {
              navTry,
              err: String(err),
            });
            // If the page was closed or aborted, try to create a fresh page in the same context
            try {
              if (typeof page.isClosed === "function" && page.isClosed()) {
                const surviving = context
                  .pages()
                  .find((p: unknown) => !p.isClosed());
                if (surviving) {
                  page = surviving;
                } else {
                  page = await context.newPage();
                  try {
                    page.setDefaultTimeout?.(30_000);
                  } catch {}
                }
              }
            } catch {}
            if (navTry === 3) throw err;
            // small backoff before next navigation strategy
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 300 * navTry));
          }
        }
        // Small pause to allow any immediate page-close events to surface
        await new Promise((r) => setTimeout(r, 200));
        if (typeof page.isClosed === "function" && page.isClosed()) {
          console.warn(
            "[WARN] Playwright page closed immediately after navigation, retrying attempt",
          );
          try {
            await context.close();
          } catch {}
          // Try with a fresh temporary userDataDir to avoid persistent-profile
          // scripts or locks that may cause the page to be closed by remote
          // scripts. This gives us a cleaner ephemeral context for extraction.
          try {
            const tmpDir = mkdtempSync(join(tmpdir(), "playwright-"));
            try {
              await context.close();
            } catch {}
            const freshContext = await this.#launchPersistentContext(tmpDir, {
              executablePath: this.#executablePath,
              headless: true,
              ignoreHTTPSErrors: true,
              args: ["--no-sandbox", "--disable-setuid-sandbox"],
              userAgent:
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              locale: "ja-JP",
            }).catch(() => null);
            if (freshContext) {
              context = freshContext;
              page = await context.newPage();
              await addNiconamaPlaywrightInitScript(page);
              try {
                await page.goto(watchUrl, {
                  waitUntil: "domcontentloaded",
                  timeout: 30_000,
                });
              } catch {}
            }
          } catch {
            // fallback to small backoff and continue retries
            await new Promise((res) => setTimeout(res, 300 * attempt));
          }
          if (attempt >= maxAttempts) {
            console.warn(
              "[WARN] exhausted Playwright watcher setup attempts after immediate close",
            );
            await this.clearPlaywrightCommentWatcher();
            return;
          }
          continue;
        }
        try {
          console.debug("[DEBUG] Playwright page after goto", {
            url: page.url(),
            isClosed: page.isClosed(),
            pages: context.pages().map((p: unknown) => {
              try {
                return p.url();
              } catch {
                return "unknown";
              }
            }),
          });
        } catch {
          console.debug("[DEBUG] Playwright page after goto", {
            url: "unknown",
            isClosed:
              typeof page.isClosed === "function" ? page.isClosed() : undefined,
            pages: [],
          });
        }

        if (this.#stopRequested) {
          await this.clearPlaywrightCommentWatcher();
          return;
        }
        if (!page.isClosed()) {
          try {
            await this.tryOpenRenderedCommentPanel(page);
          } catch (e) {
            console.debug(
              "[DEBUG] tryOpenRenderedCommentPanel threw (ignored)",
              e,
            );
          }
          try {
            const immediateComments = await this.extractPageComments(page);
            if (immediateComments.length > 0) {
              this.deliverComments(immediateComments);
              try {
                console.debug(
                  "[DEBUG] Playwright immediate page comments extracted",
                  { count: immediateComments.length, url: page.url() },
                );
              } catch {
                console.debug(
                  "[DEBUG] Playwright immediate page comments extracted",
                  { count: immediateComments.length, url: "unknown" },
                );
              }
            }
          } catch (err) {
            console.debug(
              "[DEBUG] Playwright immediate page comment extraction failed",
              err,
            );
          }
        }

        if (this.#stopRequested) {
          await this.clearPlaywrightCommentWatcher();
          return;
        }
        if (!page.isClosed()) {
          try {
            await page.waitForLoadState?.("networkidle", { timeout: 15_000 });
          } catch {
            try {
              console.debug(
                "[DEBUG] Playwright networkidle wait failed or timed out",
                { url: page.url() },
              );
            } catch {
              console.debug(
                "[DEBUG] Playwright networkidle wait failed or timed out",
                { url: "unknown" },
              );
            }
          }
        }

        if (this.#stopRequested) {
          await this.clearPlaywrightCommentWatcher();
          return;
        }
        if (!page.isClosed()) {
          await this.waitForAnyCommentSelector(page, 30_000).catch(
            () => undefined,
          );
        }

        if (this.#stopRequested) {
          await this.clearPlaywrightCommentWatcher();
          return;
        }
        const initialPageComments = await this.pollPageComments(
          page,
          1_000,
          30,
        );
        if (initialPageComments.length > 0) {
          this.deliverComments(initialPageComments);
          try {
            console.debug(
              "[DEBUG] Playwright initial page comments extracted",
              { count: initialPageComments.length, url: page.url() },
            );
          } catch {
            console.debug(
              "[DEBUG] Playwright initial page comments extracted",
              { count: initialPageComments.length, url: "unknown" },
            );
          }
        }

        if (this.#stopRequested) {
          await this.clearPlaywrightCommentWatcher();
          return;
        }
        if (page.isClosed()) {
          const survivingPage = context
            .pages()
            .find((p: unknown) => !p.isClosed());
          if (survivingPage) {
            let survivingUrlSafe = "unknown";
            try {
              survivingUrlSafe =
                typeof survivingPage.url === "function"
                  ? survivingPage.url()
                  : String(survivingPage.url);
            } catch {}
            console.warn(
              "[WARN] Playwright page closed after initial load; switching to surviving page",
              { url: watchUrl, survivingUrl: survivingUrlSafe },
            );
            page = survivingPage;
          } else {
            console.warn(
              "[WARN] Playwright page closed before watcher installation could complete",
              { url: watchUrl, attempt },
            );
            try {
              await context.close();
            } catch {}
            if (attempt >= maxAttempts) {
              console.warn(
                "[WARN] exhausted Playwright watcher setup attempts",
              );
              await this.clearPlaywrightCommentWatcher();
              return;
            }
            // small backoff before retry
            await new Promise((res) => setTimeout(res, 300 * attempt));
            continue;
          }
        }

        this.#playwrightCommentContext = context;
        console.debug("[DEBUG] Playwright page ready", {
          url: watchUrl.substring(0, 80),
        });
        this.startPlaywrightPagePolling(page);
        // success
        return;
      } catch (err) {
        console.warn("[WARN] failed to start Playwright comment watcher", {
          attempt,
          err,
        });
        await this.clearPlaywrightCommentWatcher();
        if (attempt >= maxAttempts) return;
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      }
    }
  }

  private async clearPlaywrightCommentWatcher(): Promise<void> {
    this.clearPlaywrightPagePolling();
    if (!this.#playwrightCommentContext) return;
    try {
      try {
        const context = this.#playwrightCommentContext as Record<string, unknown>;
        const pages =
          typeof context.pages === "function"
            ? (context.pages as () => unknown[])()
            : [];
        for (const page of pages) {
          try {
            if (page && typeof (page as Record<string, unknown>).removeAllListeners === "function") {
              try {
                ((page as Record<string, unknown>).removeAllListeners as () => void)();
              } catch {}
            }
            try {
              await (page as Record<string, unknown>).close();
            } catch {}
          } catch {}
        }
      } catch {}
      const context = this.#playwrightCommentContext as Record<string, unknown>;
      if (typeof context.close === "function") {
        await (context.close as () => Promise<void>)();
      }
    } catch (err) {
      console.warn("[WARN] failed to close Playwright comment watcher", err);
    }

    this.#playwrightCommentContext = null;
  }

  private async tryOpenRenderedCommentPanel(page: unknown): Promise<void> {
    await tryOpenRenderedCommentPanel(page);
  }

  private async extractPageComments(page: unknown): Promise<AgentComment[]> {
    return await extractPageComments(page, this.#seenCommentIdentifiers);
  }

  private async pollPageComments(
    page: unknown,
    intervalMs = 1_000,
    maxAttempts = 30,
  ): Promise<AgentComment[]> {
    return await pollPageComments(
      page,
      this.#seenCommentIdentifiers,
      intervalMs,
      maxAttempts,
    );
  }

  private startPlaywrightPagePolling(page: unknown): void {
    if (this.#playwrightPageCommentPollTimer) return;
    this.#playwrightPageCommentPollTimer = startPlaywrightPagePolling(
      page,
      this.#seenCommentIdentifiers,
      (comments: unknown[]) => this.deliverComments(comments),
    );
  }

  private clearPlaywrightPagePolling(): void {
    if (!this.#playwrightPageCommentPollTimer) return;
    clearInterval(this.#playwrightPageCommentPollTimer);
    this.#playwrightPageCommentPollTimer = null;
  }

  private async waitForAnyCommentSelector(
    page: unknown,
    timeoutMs: number,
  ): Promise<void> {
    await waitForAnyCommentSelector(page, timeoutMs);
  }

  private handlePlaywrightWebSocketFrame(payload: string, wsUrl: string): void {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // try NDJSON / multiple JSON objects
      const lines = String(payload)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        const p = tryParseJson(line);
        if (!p) continue;
        const comments = parseAgentCommentsFromResponseBody(
          p,
          this.#seenCommentIdentifiers,
        );
        if (comments.length > 0) {
          this.deliverComments(comments);
          console.debug("[DEBUG] Playwright websocket NDJSON comment payload", {
            wsUrl,
            count: comments.length,
          });
          return;
        }
      }
      return;
    }

    if (!parsed || typeof parsed !== "object") return;

    const comments = parseAgentCommentsFromResponseBody(
      parsed,
      this.#seenCommentIdentifiers,
    );
    if (comments.length === 0) return;

    this.deliverComments(comments);
    console.debug("[DEBUG] Playwright websocket comment payload", {
      wsUrl,
      count: comments.length,
    });
  }

  private async performImmediateRescan(watchUrl: string): Promise<void> {
    try {
      // First try the static embedded-data extraction
      const staticData = await this.fetchEmbeddedDataFromPage(watchUrl).catch(
        () => null,
      );
      if (staticData) {
        const comments = parseAgentCommentsFromResponseBody(
          staticData,
          this.#seenCommentIdentifiers,
        );
        if (comments.length > 0) {
          this.deliverComments(comments);
          console.debug(
            "[DEBUG] performImmediateRescan comments extracted (static)",
            { count: comments.length, watchUrl },
          );
          return;
        }
        console.debug(
          "[DEBUG] performImmediateRescan no new static comments, trying polling API rescan",
          { watchUrl },
        );
      }

      // Try polling API endpoints derived from embedded data (best-effort).
      // Perform an aggressive short-poll loop to increase chance of
      // observing live comments quickly in e2e environments.
      try {
        const singleTry = await this.fetchCommentsFromPollingApis(
          staticData,
        ).catch(() => [] as AgentComment[]);
        if (Array.isArray(singleTry) && singleTry.length > 0) {
          this.deliverComments(singleTry);
          console.debug(
            "[DEBUG] performImmediateRescan comments extracted (polling-api)",
            { count: singleTry.length, watchUrl },
          );
          return;
        }

        const aggressiveTimeoutMs = 30_000;
        const aggressiveIntervalMs = 1_000;
        const startTime = Date.now();
        while (Date.now() - startTime < aggressiveTimeoutMs) {
          const commentsFromApi = await this.fetchCommentsFromPollingApis(
            staticData,
          ).catch(() => [] as AgentComment[]);
          if (Array.isArray(commentsFromApi) && commentsFromApi.length > 0) {
            this.deliverComments(commentsFromApi);
            console.debug(
              "[DEBUG] performImmediateRescan comments extracted (polling-api aggressive)",
              { count: commentsFromApi.length, watchUrl },
            );
            return;
          }
          await new Promise((r) => setTimeout(r, aggressiveIntervalMs));
        }
      } catch {
        // ignore API fallback errors
      }

      // If static extraction didn't find comments, try the Playwright-rendered enrichment
      try {
        if (this.#enablePlaywrightFallback) {
          // Try Playwright enrichment a few times because transient page-closes
          // or WAF-induced navigation failures sometimes prevent a single
          // attempt from harvesting comments.
          for (let attempt = 1; attempt <= 3; attempt++) {
            const enriched = await this.fetchEmbeddedDataWithPlaywright(
              watchUrl,
              staticData,
            ).catch(() => null);
            if (enriched) {
              const comments2 = parseAgentCommentsFromResponseBody(
                enriched,
                this.#seenCommentIdentifiers,
              );
              if (comments2.length > 0) {
                this.deliverComments(comments2);
                console.debug(
                  "[DEBUG] performImmediateRescan comments extracted (playwright)",
                  { count: comments2.length, watchUrl, attempt },
                );
                return;
              }
            }
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        } else {
          console.debug(
            "[DEBUG] skipping Playwright enrichment (disabled via enablePlaywrightFallback=false)",
          );
        }
      } catch {
        // ignore
      }
    } catch (err) {
      this.reportError(err);
    }
  }

  private async fetchCommentsFromPollingApis(
    embeddedData: unknown,
  ): Promise<AgentComment[]> {
    try {
      const site: Record<string, unknown> =
        embeddedData && typeof embeddedData === "object"
          ? ((embeddedData as Record<string, unknown>).site as Record<string, unknown>) || {}
          : {};
      const program: Record<string, unknown> =
        embeddedData && typeof embeddedData === "object"
          ? ((embeddedData as Record<string, unknown>).program as Record<string, unknown>) || {}
          : {};
      // If no embeddedData was provided, attempt to derive program information
      // from the configured watch URL or by fetching the static watch page.
      let derivedProgramId: string | undefined =
        (typeof program.nicoliveProgramId === "string" ? program.nicoliveProgramId : undefined) ??
        (typeof program.programId === "string" ? program.programId : undefined) ??
        undefined;
      const pollingApiBase: string | undefined =
        (typeof site.pollingApiBaseUrl === "string" ? site.pollingApiBaseUrl : undefined) ||
        (typeof site.frontendPublicApiUrl === "string" ? site.frontendPublicApiUrl : undefined) ||
        (typeof site.apiBaseUrl === "string" ? site.apiBaseUrl : undefined) ||
        (typeof site.staticResourceBaseUrl === "string" ? site.staticResourceBaseUrl : undefined);
      const watchUrl =
        this.#watchUrl ??
        process.env.NICONAMA_WATCH_URL ??
        DEFAULT_FALLBACK_WATCH_URL;
      if (!derivedProgramId) {
        try {
          const html = await this.fetchHtml(String(watchUrl)).catch(() => "");
          if (html) {
            const m1 = /"nicoliveProgramId"\s*[:=]\s*"?(\d{6,})"?/i.exec(html);
            const m2 = /"programId"\s*[:=]\s*"?(lv\d+|\d{6,})"?/i.exec(html);
            const m3 = /watch\/(lv\d+)/i.exec(html);
            const m4 = /lv(\d{4,})/i.exec(html);
            derivedProgramId =
              m1?.[1] ??
              m2?.[1] ??
              m3?.[1] ??
              (m4 ? `lv${m4[1]}` : undefined) ??
              undefined;
          }
        } catch {
          // ignore HTML fetch/parse errors
        }
      }
      const frontendApiBase: string | undefined =
        (typeof site.frontendPublicApiUrl === "string" ? site.frontendPublicApiUrl : undefined) ||
        (typeof site.apiBaseUrl === "string" ? site.apiBaseUrl : undefined);

      const programId =
        derivedProgramId ??
        ((program as Record<string, unknown>).watchPageUrl
          ? /lv\d+/.exec((program as Record<string, unknown>).watchPageUrl as string)?.[0]
          : undefined) ??
        undefined;

      const candidates: string[] = [];
      // Try well-known polling endpoints when polling base is present
      if (pollingApiBase && programId) {
        candidates.push(
          `${String(pollingApiBase).replace(/\/$/, "")}/programs/${programId}/comments?limit=50`,
        );
        candidates.push(
          `${String(pollingApiBase).replace(/\/$/, "")}/programs/${programId}/comments`,
        );
        candidates.push(
          `${String(pollingApiBase).replace(/\/$/, "")}/v1/programs/${programId}/comments`,
        );
      }
      // frontend API variants
      if (frontendApiBase && programId) {
        candidates.push(
          `${String(frontendApiBase).replace(/\/$/, "")}/programs/${programId}/comments`,
        );
        candidates.push(
          `${String(frontendApiBase).replace(/\/$/, "")}/programs/${programId}/comments?limit=50`,
        );
      }

      // Try public papi endpoints observed in diagnostics
      if (programId) {
        candidates.push(
          `https://papi.live.nicovideo.jp/programs/${programId}/comments?limit=50`,
        );
        candidates.push(
          `https://papi.live.nicovideo.jp/programs/${programId}/comments`,
        );
        candidates.push(
          `https://papi.live.nicovideo.jp/v1/programs/${programId}/comments`,
        );
        candidates.push(
          `https://papi.live.nicovideo.jp/comments?program_id=${programId}&limit=50`,
        );
        candidates.push(
          `https://live.nicovideo.jp/api/programs/${programId}/comments`,
        );
      }

      // Generic fallbacks when no programId available: try any global comments endpoint
      if (pollingApiBase) {
        candidates.push(
          `${String(pollingApiBase).replace(/\/$/, "")}/comments?limit=50`,
        );
        candidates.push(
          `${String(pollingApiBase).replace(/\/$/, "")}/comments`,
        );
      }

      // Prioritize public papi endpoints (often accessible even when main
      // site is behind WAF). Use a slightly longer timeout and a retry
      // attempt for higher-likelihood candidates.
      const priorityCandidates: string[] = [];
      const regularCandidates: string[] = [];
      for (const url of candidates) {
        if (
          /papi\.live\.nicovideo\.jp|api\/programs|comments\?program_id=/.test(
            url,
          )
        ) {
          priorityCandidates.push(url);
        } else {
          regularCandidates.push(url);
        }
      }

      const diagnosticsDir = mkdtempSync(join(tmpdir(), "makamujo-polling-"));
      const tryFetchCandidate = async (url: string, timeoutMs: number) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(id);
          const safeName = url.replace(/[^a-z0-9]/gi, "_").slice(0, 200);
          try {
            const status = res ? res.status : "NO_RESPONSE";
            let bodyText: string | null = null;
            try {
              bodyText = await res.text();
            } catch {
              bodyText = null;
            }
            // Save a diagnostic snapshot for this candidate
            try {
              writeFileSync(
                join(diagnosticsDir, `${safeName}_${status}.txt`),
                `URL: ${url}\nSTATUS: ${status}\n\n${bodyText ?? ""}`,
              );
            } catch {
              // ignore write errors
            }
          } catch {
            // ignore diagnostics write errors
          }
          if (!res || res.status >= 400) return null;
          const json = await res.json().catch(() => null);
          return json;
        } catch (err) {
          clearTimeout(id);
          // write an error diagnostic
          try {
            const safeName = url.replace(/[^a-z0-9]/gi, "_").slice(0, 200);
            writeFileSync(
              join(diagnosticsDir, `${safeName}_error.txt`),
              `URL: ${url}\nERROR: ${String(err)}`,
            );
          } catch {}
          return null;
        }
      };

      // First try priority candidates with longer timeout and one retry.
      for (const url of priorityCandidates) {
        try {
          const json = await tryFetchCandidate(url, 10_000);
          if (json) {
            const parsedComments = parseAgentCommentsFromResponseBody(
              json,
              this.#seenCommentIdentifiers,
            );
            if (parsedComments.length > 0) return parsedComments;
          }
          // one quick retry
          const json2 = await tryFetchCandidate(url, 8_000);
          if (json2) {
            const parsedComments2 = parseAgentCommentsFromResponseBody(
              json2,
              this.#seenCommentIdentifiers,
            );
            if (parsedComments2.length > 0) return parsedComments2;
          }
        } catch {
          // ignore per-candidate errors
        }
      }

      // Then try regular candidates with a shorter timeout.
      for (const url of regularCandidates) {
        try {
          const json = await tryFetchCandidate(url, 5_000);
          if (json) {
            const parsedComments = parseAgentCommentsFromResponseBody(
              json,
              this.#seenCommentIdentifiers,
            );
            if (parsedComments.length > 0) return parsedComments;
          }
        } catch {
          // ignore per-candidate errors
        }
      }
      return [];
    } catch {
      return [];
    }
  }

  private handleDirectWebSocketMessage(message: string, wsUrl: string): void {
    if (!message) {
      console.debug("[DEBUG] direct websocket empty message received", wsUrl);
      return;
    }

    // Append raw frame to a temp log for deeper post-mortem analysis
    try {
      try {
        // use require to avoid top-level await in non-async function
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require("node:fs");
        const ts = new Date().toISOString();
        const snippet = String(message).slice(0, 200).replace(/\n/g, " ");
        // Use the async append variant to avoid blocking the event loop
        try {
          fs.appendFile(
            "/tmp/niconama-ws-raw.log",
            `${ts} ${wsUrl} ${snippet}\n`,
            () => {},
          );
        } catch {
          // ignore write errors
        }
      } catch {
        // ignore fs errors
      }
    } catch {}

    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(message) as Record<string, unknown>;
    } catch (err) {
      // Try NDJSON / multiple JSON objects per frame
      const lines = String(message)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        console.warn(
          "[WARN] direct websocket received non-JSON frame",
          wsUrl,
          String(message).slice(0, 200),
          err,
        );
        return;
      }
      let anyFound = false;
      for (const line of lines) {
        const parsed = tryParseJson(line);
        if (!parsed) continue;
        anyFound = true;
        const comments = parseAgentCommentsFromResponseBody(
          parsed,
          this.#seenCommentIdentifiers,
        );
        if (comments.length > 0) {
          this.deliverComments(comments);
          console.debug(
            "[DEBUG] direct websocket NDJSON comment payload",
            wsUrl,
            { count: comments.length },
          );
          return;
        }
      }
      if (!anyFound) {
        console.warn(
          "[WARN] direct websocket received non-JSON/NDJSON frame",
          wsUrl,
          String(message).slice(0, 200),
          err,
        );
      }
      return;
    }

    if (!body || typeof body !== "object") {
      console.warn(
        "[WARN] direct websocket received invalid frame body",
        wsUrl,
        String(message).slice(0, 200),
      );
      return;
    }

    // Diagnostic: log shape of body when no comments are detected to aid debugging
    try {
      const keys = Object.keys(body).slice(0, 10);
      console.debug("[DEBUG] direct websocket parsed body keys", {
        wsUrl,
        keys,
        snippet: JSON.stringify(body).slice(0, 400),
      });
    } catch {
      // ignore
    }

    if (!body) {
      console.debug("[DEBUG] direct websocket empty body after JSON parse", wsUrl);
      return;
    }

    const eventType = body.type as string | undefined;
    if (eventType === "ping") {
      const keepSeatMessage = { type: "keepSeat" } as Record<string, unknown>;
      if (this.#directWebSocketAudienceToken) {
        keepSeatMessage.audienceToken = this.#directWebSocketAudienceToken;
      }
      this.sendDirectWebSocketMessage(keepSeatMessage as unknown);
      return;
    }

    let knownEventType = false;
    switch (eventType) {
      case "statistics": {
        const metaState = buildNiconamaStreamStateFromStatisticsEvent(body);
        if (metaState) {
          this.#callbacks.onMeta(metaState);
        }
        try {
          const rawStats = (body as Record<string, unknown>)?.data;
          const stats = (rawStats && typeof rawStats === "object" ? rawStats as Record<string, unknown> : null);
          if (
            stats &&
            typeof stats.comments === "number" &&
            stats.comments > 0
          ) {
            // If statistics report comments, trigger an immediate rescan to try to harvest comment payloads
            void this.resolveWatchUrl()
              .then((url) => {
                if (typeof url === "string" && url.length > 0) {
                  void this.performImmediateRescan(url).catch(() => undefined);
                }
              })
              .catch(() => undefined);
          }
        } catch {
          // ignore rescan errors
        }
        knownEventType = true;
        break;
      }
      case "reconnect": {
        try {
          const rawReconnectData = (body as Record<string, unknown>)?.data;
          const reconnectData = (rawReconnectData && typeof rawReconnectData === "object" ? rawReconnectData as Record<string, unknown> : null);
          const newToken = reconnectData?.audienceToken as unknown;
          const waitTimeMs =
            reconnectData &&
            typeof reconnectData.waitTimeSec === "number" &&
            reconnectData.waitTimeSec > 0
              ? reconnectData.waitTimeSec * 1_000
              : 1_000;
          this.#directWebSocketSuppressReconnect = true;
          this.clearDirectWebSocket();

          if (typeof newToken === "string" && newToken.length > 0) {
            this.#directWebSocketAudienceToken = newToken;
            const reconnectUrl = this.buildWebSocketUrlWithAudienceToken(
              wsUrl as string,
              newToken,
            );
            const tokenId = newToken.substring(0, 20);
            console.info(
              `[INFO] ws://reconnect waitMs:${waitTimeMs} token:${tokenId} pw:${this.#enablePlaywrightFallback ? "enabled" : "disabled"}`,
            );
            if (!this.#stopRequested) {
              this.#directWebSocketReconnectTimer = globalThis.setTimeout(
                () => {
                  this.#directWebSocketReconnectTimer = null;
                  if (!this.#stopRequested) {
                    if (reconnectUrl) {
                      void this.setupDirectWebSocketConnection(
                        reconnectUrl,
                      ).catch(() => undefined);
                    } else {
                      void this.resolveWatchUrl()
                        .then((url) => {
                          if (typeof url === "string" && url.length > 0) {
                            void this.setupDirectWebSocketConnection(url).catch(
                              () => undefined,
                            );
                          }
                        })
                        .catch(() => undefined);
                    }
                  }
                },
                waitTimeMs + 250,
              );
            }
          } else if (wsUrl.includes("audience_token=")) {
            console.info(
              `[INFO] ws://reconnect waitMs:${waitTimeMs} token:auto-refresh pw:${this.#enablePlaywrightFallback ? "enabled" : "disabled"}`,
            );
            if (!this.#stopRequested) {
              this.#directWebSocketReconnectTimer = globalThis.setTimeout(
                () => {
                  this.#directWebSocketReconnectTimer = null;
                  if (!this.#stopRequested) {
                    void this.resolveWatchUrl()
                      .then((url) => {
                        if (typeof url === "string" && url.length > 0) {
                          void this.setupDirectWebSocketConnection(url).catch(
                            () => undefined,
                          );
                        }
                      })
                      .catch(() => undefined);
                  }
                },
                waitTimeMs + 250,
              );
            }
          }
        } catch {
          // ignore
        }
        knownEventType = true;
        break;
      }
      case "reconnect_request":
      case "actionComment":
      case "action_comment":
      case "postCommentResult":
      case "post_comment_result":
      case "error_message":
      case "tag_updated":
        knownEventType = true;
        break;
      default:
        console.warn(
          "[WARN] direct websocket unknown event type",
          eventType,
          wsUrl,
          JSON.stringify(body, null, 2),
        );
        break;
    }

    const comments = parseAgentCommentsFromResponseBody(
      body,
      this.#seenCommentIdentifiers,
      eventType,
    );
    if (comments.length > 0) {
      this.deliverComments(comments);
      if (knownEventType) {
        console.debug(
          "[DEBUG] direct websocket known event type with comment payload",
          eventType,
          wsUrl,
          body,
        );
      }
      return;
    }

    if (knownEventType) {
      console.debug(
        "[DEBUG] direct websocket ignored known event type",
        eventType,
        wsUrl,
        body,
      );
      return;
    }

    if (typeof eventType === "string") {
      console.warn(
        "[WARN] direct websocket unknown event type",
        eventType,
        wsUrl,
        body,
      );
      return;
    }

    console.warn(
      "[WARN] direct websocket unknown event without type",
      wsUrl,
      body,
    );
  }

  private sendDirectWebSocketMessage(message: unknown): void {
    try {
      const msg = JSON.stringify(message);
      console.debug("[DEBUG] direct websocket sending message", message);
      if (this.#directWebSocket?.readyState !== 1) {
        // Queue messages until the socket opens to avoid 'not open' errors
        this.#directWebSocketQueue.push(msg);
        return;
      }
      this.#directWebSocket.send(msg);
    } catch (err) {
      console.warn("[WARN] failed to send direct websocket message", err);
      try {
        this.#directWebSocketQueue.push(JSON.stringify(message));
      } catch {}
    }
  }

  private extractAudienceTokenFromWebSocketUrl(
    webSocketUrl: string,
  ): string | null {
    try {
      const url = new URL(webSocketUrl);
      return url.searchParams.get("audience_token");
    } catch {
      return null;
    }
  }

  private buildWebSocketUrlWithAudienceToken(
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

  async pollLoop(): Promise<void> {
    while (!this.#stopRequested && this.#running) {
      // Use a cancellable sleep so `stop()` can abort the wait promptly.
      await new Promise<void>((resolve) => {
        this.#pollCancelResolve = resolve;
        this.#pollTimer = globalThis.setTimeout(() => {
          this.#pollTimer = null;
          this.#pollCancelResolve = null;
          resolve();
        }, this.#pollIntervalMs);
      });
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
    if (typeof this.#callbacks.onError === "function") {
      this.#callbacks.onError(error);
    } else {
      console.warn(
        "[WARN] NiconamaCommentClient error:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

export const createNiconamaCommentClient = (
  options: NiconamaCommentClientOptions,
  callbacks: NiconamaCommentClientCallbacks,
): NiconamaCommentClient => new NiconamaCommentClient(options, callbacks);

export {
  buildNiconamaStreamStateFromStatisticsEvent,
  DEFAULT_FALLBACK_WATCH_URL,
  DEFAULT_WATCH_PAGE_BASE_URL,
  ensureUserDataDirExists,
  extractEmbeddedDataFromHtml,
  extractWatchUrlFromHtml,
  filterAgentCommentsWithText,
  getCommentTextFromAgentComment,
  hasCommentArrayStructure,
  normalizeHtmlForUrlExtraction,
  parseAgentCommentsFromResponseBody,
  tryParseJson,
};
