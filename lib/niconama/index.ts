/**
 * lib/niconama/index.ts
 *
 * リアーキテクチャリングされたニコ生コメントクライアント群のエントリポイント。
 *
 * ## 旧アーキテクチャ（lib/niconamaCommentClient.ts）との対応
 *
 * | 旧責務 | 新モジュール |
 * |---|---|
 * | URL解決 | WatchUrlResolver |
 * | HTML取得・embedded-data解析 | EmbeddedDataFetcher |
 * | WebSocket接続・再接続・KeepAlive | WebSocketConnection |
 * | Playwright監視 | PlaywrightCommentWatcher |
 * | REST APIポーリング | CommentPoller |
 * | コメント重複除外 | SeenCommentTracker |
 * | 全体制御・ファサード | NiconamaClient |
 */
import type { AgentComment } from "automated-gameplay-transmitter";
import { parseAgentCommentsFromResponseBody } from "../niconamaCommentClient.helpers";
import {
  DEFAULT_PLAYWRIGHT_USER_DATA_DIR,
  launchPersistentContext,
} from "../Browser/chromium";
import {
  DEFAULT_FALLBACK_WATCH_URL,
  DEFAULT_POLL_INTERVAL_MS,
  type NiconamaCommentClientCallbacks,
  type NiconamaCommentClientOptions,
  type NiconamaLaunchPersistentContext,
} from "./types";
import { SeenCommentTracker } from "./SeenCommentTracker";
import { ensureUserDataDirExists, WatchUrlResolver } from "./WatchUrlResolver";
import { EmbeddedDataFetcher, resolveWebSocketUrl } from "./EmbeddedDataFetcher";
import {
  extractAudienceTokenFromWebSocketUrl,
  WebSocketConnection,
} from "./WebSocketConnection";
import { PlaywrightCommentWatcher } from "./PlaywrightCommentWatcher";
import { CommentPoller } from "./CommentPoller";

export type {
  NiconamaCommentClientOptions,
  NiconamaCommentClientCallbacks,
} from "./types";
export { SeenCommentTracker } from "./SeenCommentTracker";
export { WatchUrlResolver, ensureUserDataDirExists, fetchHtml } from "./WatchUrlResolver";
export { EmbeddedDataFetcher, resolveWebSocketUrl, getWebSocketUrlFromEmbeddedData, getFrontendIdFromEmbeddedData } from "./EmbeddedDataFetcher";
export { WebSocketConnection, decodeWebSocketData, extractAudienceTokenFromWebSocketUrl } from "./WebSocketConnection";
export { PlaywrightCommentWatcher } from "./PlaywrightCommentWatcher";
export { CommentPoller } from "./CommentPoller";

/**
 * リアーキテクチャリングされたニコ生コメントクライアント。
 *
 * 旧 `NiconamaCommentClient` (3379行) の責務を各専用クラスに委譲する
 * ファサードクラス。公開APIは旧クラスと互換性を維持する。
 */
export class NiconamaClient {
  readonly #seenTracker: SeenCommentTracker;
  readonly #watchUrlResolver: WatchUrlResolver;
  readonly #embeddedDataFetcher: EmbeddedDataFetcher;
  readonly #wsConnection: WebSocketConnection;
  readonly #playwrightWatcher: PlaywrightCommentWatcher;
  readonly #commentPoller: CommentPoller;
  readonly #callbacks: NiconamaCommentClientCallbacks;
  readonly #pollIntervalMs: number;
  readonly #enablePlaywrightFallback: boolean;

  #running = false;
  #stopRequested = false;
  #pollTask: Promise<void> | null = null;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #pollCancelResolve: (() => void) | null = null;
  #watcherTask: Promise<void> | null = null;

  static readonly MAX_SEEN_COMMENT_IDENTIFIERS = 50_000;

  constructor(
    options: NiconamaCommentClientOptions,
    callbacks: NiconamaCommentClientCallbacks,
  ) {
    this.#callbacks = callbacks;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#enablePlaywrightFallback = options.enablePlaywrightFallback ?? true;

    const userDataDir = options.userDataDir ?? DEFAULT_PLAYWRIGHT_USER_DATA_DIR;
    const executablePath = options.executablePath;
    const launchCtx = (options.launchPersistentContext ??
      launchPersistentContext) as unknown as NiconamaLaunchPersistentContext;

    this.#seenTracker = new SeenCommentTracker(
      NiconamaClient.MAX_SEEN_COMMENT_IDENTIFIERS,
    );

    this.#watchUrlResolver = new WatchUrlResolver({
      watchUrl: options.watchUrl,
      executablePath,
      launchPersistentContext: launchCtx,
      userDataDir,
    });

    this.#embeddedDataFetcher = new EmbeddedDataFetcher({
      executablePath,
      launchPersistentContext: launchCtx,
      seenTracker: this.#seenTracker,
      onComments: (comments) => this.#deliverComments(comments),
      enablePlaywrightFallback: this.#enablePlaywrightFallback,
    });

    this.#wsConnection = new WebSocketConnection({
      seenTracker: this.#seenTracker,
      watchUrlResolver: this.#watchUrlResolver,
      callbacks: {
        onComments: (comments) => this.#deliverComments(comments),
        onMeta: (state) => callbacks.onMeta(state),
        onError: callbacks.onError,
      },
      onShouldRescan: (url) => {
        void this.#performRescan(url).catch(() => undefined);
      },
    });

    this.#playwrightWatcher = new PlaywrightCommentWatcher({
      userDataDir,
      executablePath,
      launchPersistentContext: launchCtx,
      seenTracker: this.#seenTracker,
      onComments: (comments) => this.#deliverComments(comments),
    });

    this.#commentPoller = new CommentPoller({
      watchUrl: options.watchUrl ?? DEFAULT_FALLBACK_WATCH_URL,
      seenTracker: this.#seenTracker,
    });
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#stopRequested = false;

    console.debug("[DEBUG] NiconamaClient start()", {
      pollIntervalMs: this.#pollIntervalMs,
    });

    ensureUserDataDirExists(
      (this.#watchUrlResolver as unknown as { userDataDir?: string })
        .userDataDir ?? "var/playwright",
    );

    const watchUrl = await this.#watchUrlResolver.resolve();
    if (!watchUrl) {
      this.#reportError(new Error("failed to resolve NicoNico watch URL"));
      return;
    }

    // embedded-dataを取得
    let embeddedData: unknown | null = null;
    try {
      embeddedData = await this.#embeddedDataFetcher
        .fetchFromPage(watchUrl)
        .catch(() => null);
    } catch (err) {
      this.#reportError(err);
      embeddedData = null;
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

    // 起動時の初期コメント配信
    try {
      const initialComments = parseAgentCommentsFromResponseBody(
        embeddedData,
        this.#seenTracker.set,
      );
      if (initialComments.length > 0) {
        this.#deliverComments(initialComments);
      }
    } catch (err) {
      console.warn("[WARN] NiconamaClient: error checking initial comments", err);
    }

    try {
      const polled = await this.#commentPoller
        .fetchComments(embeddedData)
        .catch(() => [] as AgentComment[]);
      if (Array.isArray(polled) && polled.length > 0) {
        this.#deliverComments(polled);
      }
    } catch {}

    // WebSocket接続を確立
    await this.#setupWebSocket(watchUrl, embeddedData);

    // Playwright監視を開始（バックグラウンド）
    if (this.#enablePlaywrightFallback) {
      this.#watcherTask = this.#playwrightWatcher
        .start(watchUrl)
        .catch((err) => {
          console.warn("[WARN] NiconamaClient: PlaywrightWatcher failed", err);
        })
        .finally(() => {
          this.#watcherTask = null;
        });
    } else {
      console.debug(
        "[DEBUG] NiconamaClient: Playwright fallback disabled",
      );
    }

    // 初回再スキャン
    try {
      const reportedCount = extractCommentCount(embeddedData);
      if (typeof reportedCount === "number" && reportedCount > 0) {
        await Promise.race([
          this.#performRescan(watchUrl),
          new Promise((res) => setTimeout(res, 2000)),
        ]).catch(() => undefined);
      } else {
        void this.#performRescan(watchUrl).catch(() => undefined);
      }
    } catch {}

    this.#pollTask = this.#pollLoop();
    console.info("[DEBUG] NiconamaClient.start finished");
  }

  async stop(): Promise<void> {
    this.#stopRequested = true;
    console.info("[DEBUG] NiconamaClient.stop entered");

    if (this.#pollTask) {
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, 0);
      });
    }

    try {
      if (this.#pollTimer) {
        clearTimeout(this.#pollTimer);
        this.#pollTimer = null;
      }
      if (this.#pollCancelResolve) {
        const r = this.#pollCancelResolve;
        this.#pollCancelResolve = null;
        r();
      }
    } catch (e) {
      console.info("[WARN] NiconamaClient.stop cancel error", e);
    }

    this.#pollTask = null;
    this.#wsConnection.stop();
    await this.#playwrightWatcher.stop();

    if (this.#watcherTask) {
      try {
        await this.#watcherTask;
      } catch {}
      this.#watcherTask = null;
    }

    this.#running = false;
    console.info("[DEBUG] NiconamaClient.stop finished");
  }

  isRunning(): boolean {
    return this.#running;
  }

  /**
   * @deprecated 後方互換のために残す。fetchEmbeddedData を直接使用するより fetchFromPage を推奨。
   */
  async fetchEmbeddedData(watchUrl?: string): Promise<unknown | null> {
    const targetUrl = watchUrl ?? DEFAULT_FALLBACK_WATCH_URL;
    const embedded = await this.#embeddedDataFetcher
      .fetchFromPage(targetUrl)
      .catch(() => null);
    if (embedded) return embedded;
    if (!this.#enablePlaywrightFallback) return null;
    return await this.#embeddedDataFetcher
      .fetchWithPlaywright(targetUrl)
      .catch(() => null);
  }

  async #setupWebSocket(
    watchUrl: string,
    embeddedData: unknown,
  ): Promise<void> {
    const wsUrl = resolveWebSocketUrl(embeddedData);
    if (!wsUrl) {
      console.warn(
        "[WARN] NiconamaClient: WebSocket URL not found in embedded-data",
        { watchUrl },
      );
      return;
    }
    const audienceToken = extractAudienceTokenFromWebSocketUrl(wsUrl);
    await this.#wsConnection.connect(wsUrl, watchUrl, audienceToken);
  }

  async #performRescan(watchUrl: string): Promise<void> {
    try {
      const staticData = await this.#embeddedDataFetcher
        .fetchFromPage(watchUrl)
        .catch(() => null);
      if (staticData) {
        const comments = parseAgentCommentsFromResponseBody(
          staticData,
          this.#seenTracker.set,
        );
        if (comments.length > 0) {
          this.#deliverComments(comments);
          return;
        }
      }

      const polled = await this.#commentPoller
        .fetchComments(staticData)
        .catch(() => [] as AgentComment[]);
      if (Array.isArray(polled) && polled.length > 0) {
        this.#deliverComments(polled);
        return;
      }

      // アグレッシブなポーリング
      const aggressiveTimeoutMs = 30_000;
      const aggressiveIntervalMs = 1_000;
      const startTime = Date.now();
      while (Date.now() - startTime < aggressiveTimeoutMs) {
        const commentsFromApi = await this.#commentPoller
          .fetchComments(staticData)
          .catch(() => [] as AgentComment[]);
        if (Array.isArray(commentsFromApi) && commentsFromApi.length > 0) {
          this.#deliverComments(commentsFromApi);
          return;
        }
        await new Promise((r) => setTimeout(r, aggressiveIntervalMs));
      }

      // Playwrightフォールバック
      if (this.#enablePlaywrightFallback) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          const enriched = await this.#embeddedDataFetcher
            .fetchWithPlaywright(watchUrl, staticData ?? undefined)
            .catch(() => null);
          if (enriched) {
            const comments2 = parseAgentCommentsFromResponseBody(
              enriched,
              this.#seenTracker.set,
            );
            if (comments2.length > 0) {
              this.#deliverComments(comments2);
              return;
            }
          }
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    } catch (err) {
      this.#reportError(err);
    }
  }

  async #pollLoop(): Promise<void> {
    while (!this.#stopRequested && this.#running) {
      await new Promise<void>((resolve) => {
        this.#pollCancelResolve = resolve;
        this.#pollTimer = globalThis.setTimeout(() => {
          this.#pollTimer = null;
          this.#pollCancelResolve = null;
          resolve();
        }, this.#pollIntervalMs);
      });
      if (this.#stopRequested) break;
      if (!this.#wsConnection.hasSocket) {
        const url = await this.#watchUrlResolver.resolve();
        if (url) {
          const embeddedData = await this.#embeddedDataFetcher
            .fetchFromPage(url)
            .catch(() => null);
          await this.#setupWebSocket(url, embeddedData);
        }
      }
    }
  }

  #deliverComments(comments: unknown[]): void {
    try {
      const cb = this.#callbacks.onComments;
      if (typeof cb === "function") {
        try {
          if (
            typeof (globalThis as Record<string, unknown>).setImmediate ===
            "function"
          ) {
            const setImmediate = (globalThis as Record<string, unknown>)
              .setImmediate as (cb: () => void) => void;
            setImmediate(() => {
              try {
                cb(comments as AgentComment[]);
              } catch {}
            });
          } else {
            globalThis.setTimeout(() => {
              try {
                cb(comments as AgentComment[]);
              } catch {}
            }, 0);
          }
        } catch {
          try {
            cb(comments as AgentComment[]);
          } catch {}
        }
      }
    } catch {}

    // サイズ上限管理
    try {
      this.#seenTracker.trimIfNeeded();
    } catch {}
  }

  #reportError(error: unknown): void {
    if (typeof this.#callbacks.onError === "function") {
      this.#callbacks.onError(error);
    } else {
      console.warn(
        "[WARN] NiconamaClient error:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

/** embedded-dataからコメント件数を取得するヘルパー */
const extractCommentCount = (embeddedData: unknown): number | undefined => {
  if (!embeddedData || typeof embeddedData !== "object") return undefined;
  const embedded = embeddedData as Record<string, unknown>;
  const program = embedded.program as Record<string, unknown> | undefined;
  const stats = program?.statistics as Record<string, unknown> | undefined;
  const count = stats?.commentCount;
  return typeof count === "number" ? count : undefined;
};
