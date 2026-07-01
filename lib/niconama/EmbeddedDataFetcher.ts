import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractEmbeddedDataFromHtml,
  parseAgentCommentsFromResponseBody,
} from "../niconamaCommentClient.helpers";
import {
  addNiconamaPlaywrightInitScript,
  extractPageComments,
  scanRenderedFrameForComments,
} from "../niconamaCommentClient.playwright";
import {
  NICONAMA_USER_AGENT,
  type NiconamaBrowserContext,
  type NiconamaBrowserPage,
  type NiconamaLaunchPersistentContext,
} from "./types";
import { fetchHtml } from "./WatchUrlResolver";
import type { SeenCommentTracker } from "./SeenCommentTracker";

type EmbeddedDataFetcherOptions = {
  executablePath?: string;
  launchPersistentContext: NiconamaLaunchPersistentContext;
  seenTracker: SeenCommentTracker;
  onComments: (comments: unknown[]) => void;
  enablePlaywrightFallback: boolean;
};

/**
 * ニコ生視聴ページから embedded-data を取得するモジュール。
 *
 * 1. まず静的HTML取得でembedded-dataを抽出
 * 2. 取得できない場合はPlaywrightでレンダリングして抽出
 */
export class EmbeddedDataFetcher {
  readonly #executablePath?: string;
  readonly #launchPersistentContext: NiconamaLaunchPersistentContext;
  readonly #seenTracker: SeenCommentTracker;
  readonly #onComments: (comments: unknown[]) => void;
  readonly #enablePlaywrightFallback: boolean;

  constructor(options: EmbeddedDataFetcherOptions) {
    this.#executablePath = options.executablePath;
    this.#launchPersistentContext = options.launchPersistentContext;
    this.#seenTracker = options.seenTracker;
    this.#onComments = options.onComments;
    this.#enablePlaywrightFallback = options.enablePlaywrightFallback;
  }

  /**
   * 静的HTMLからembedded-dataを取得する。取得できない場合はnullを返す。
   */
  async fetchFromPage(watchUrl: string): Promise<unknown | null> {
    try {
      const html = await fetchHtml(watchUrl);

      // 公開終了チェック
      if (typeof html === "string" && html.includes("公開終了")) {
        return { programEnded: true, url: watchUrl };
      }

      const embeddedData = extractEmbeddedDataFromHtml(html);
      console.debug(
        "[DEBUG] EmbeddedDataFetcher.fetchFromPage extracted",
        embeddedData ? "found" : "not-found",
      );
      if (!embeddedData) {
        console.warn("[WARN] embedded-data element not found", watchUrl);
        return null;
      }
      return embeddedData;
    } catch (err) {
      console.warn("[WARN] EmbeddedDataFetcher.fetchFromPage failed", err);
      return null;
    }
  }

  /**
   * Playwrightを使ってレンダリングされたページからembedded-dataを取得する。
   */
  async fetchWithPlaywright(
    targetUrl: string,
    existingEmbeddedData?: unknown,
  ): Promise<unknown | null> {
    if (!this.#enablePlaywrightFallback) {
      console.debug(
        "[DEBUG] EmbeddedDataFetcher: Playwright fallback disabled",
      );
      return null;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), "niconama-playwright-"));
    let context: NiconamaBrowserContext | null = null;
    try {
      context = await this.#launchPersistentContext(tmpDir, {
        executablePath: this.#executablePath,
        headless: true,
        ignoreHTTPSErrors: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        userAgent: NICONAMA_USER_AGENT,
        locale: "ja-JP",
      });

      if (!context) throw new Error("Failed to launch context");
      const page = context.pages()[0] ?? (await context.newPage());
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

      // レンダリングされたフレームからコメントを抽出
      const comments = await scanRenderedFrameForComments(page).catch(
        () => [] as string[],
      );
      console.debug(
        "[DEBUG] EmbeddedDataFetcher.fetchWithPlaywright scanned comments",
        { count: Array.isArray(comments) ? comments.length : 0 },
      );
      if (Array.isArray(comments) && comments.length > 0) {
        const enriched = buildEnrichedEmbeddedData(
          existingEmbeddedData,
          comments,
        );
        const parsedComments = extractParsedComments(enriched);
        if (parsedComments.length > 0) {
          this.#onComments(parsedComments);
        }
        return enriched;
      }

      // ページ評価による抽出
      try {
        const pageComments = await extractPageComments(
          page,
          this.#seenTracker.set,
        ).catch(() => [] as unknown[]);
        if (Array.isArray(pageComments) && pageComments.length > 0) {
          const enriched2 = buildEnrichedEmbeddedDataFromAgentComments(
            existingEmbeddedData,
            pageComments,
          );
          this.#onComments(pageComments);
          return enriched2;
        }
      } catch {}

      // HTMLコンテンツから直接抽出
      try {
        const pageHtml =
          typeof page.content === "function" ? await page.content() : null;
        if (typeof pageHtml === "string" && pageHtml.length > 0) {
          const extracted = extractEmbeddedDataFromHtml(pageHtml);
          console.debug(
            "[DEBUG] EmbeddedDataFetcher: extracted embedded data from page content",
            { hasEmbeddedData: Boolean(extracted) },
          );
          if (extracted) {
            return extracted;
          }
        }
      } catch (e) {
        console.warn(
          "[WARN] EmbeddedDataFetcher: failed to extract from rendered page content",
          e && (e as Record<string, unknown>).message
            ? (e as Record<string, unknown>).message
            : String(e),
        );
      }

      return null;
    } finally {
      try {
        await context?.close?.();
      } catch {}
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }

  /**
   * ページのレンダリングされたコメントを取得する（診断用）。
   */
  async fetchRenderedPageComments(
    targetUrl: string,
    seenSet: Set<string>,
  ): Promise<unknown[]> {
    const tempUserDataDir = mkdtempSync(
      join(tmpdir(), "niconama-page-comments-"),
    );
    let context: NiconamaBrowserContext | null = null;
    try {
      context = await this.#launchPersistentContext(tempUserDataDir, {
        executablePath: this.#executablePath,
        headless: true,
        ignoreHTTPSErrors: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        userAgent: NICONAMA_USER_AGENT,
        locale: "ja-JP",
      });

      if (!context) return [];
      const page = await context.newPage();
      await addNiconamaPlaywrightInitScript(page);
      const response = await page
        .goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch(() => null);
      if (!response) return [];

      try {
        await page.waitForLoadState?.("networkidle", { timeout: 10_000 });
      } catch {}
      try {
        await page.waitForTimeout?.(2_000);
      } catch {}

      const comments = await extractPageComments(page, seenSet).catch(
        () => [],
      );
      return comments;
    } catch (err) {
      console.warn("[WARN] EmbeddedDataFetcher.fetchRenderedPageComments", err);
      return [];
    } finally {
      if (context) await context.close().catch(() => undefined);
      try {
        rmSync(tempUserDataDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

// ---- ヘルパー関数 ----

/**
 * コメント文字列リストからenriched embedded-dataオブジェクトを構築する。
 */
const buildEnrichedEmbeddedData = (
  existingEmbeddedData: unknown,
  comments: string[],
): Record<string, unknown> => {
  const enriched: Record<string, unknown> =
    existingEmbeddedData && typeof existingEmbeddedData === "object"
      ? JSON.parse(JSON.stringify(existingEmbeddedData))
      : { site: { state: { relive: {} } } };

  const enrichedRec = enriched;
  enrichedRec.site =
    (enrichedRec.site as Record<string, unknown> | undefined) ?? {};
  const site = enrichedRec.site as Record<string, unknown>;
  site.state = (site.state as Record<string, unknown> | undefined) ?? {};
  const state = site.state as Record<string, unknown>;
  state.relive = (state.relive as Record<string, unknown> | undefined) ?? {};
  const relive = state.relive as Record<string, unknown>;
  relive.comments = comments.map((c: string) => ({ comment: c }));

  return enriched;
};

/**
 * AgentComment[]からenriched embedded-dataオブジェクトを構築する。
 */
const buildEnrichedEmbeddedDataFromAgentComments = (
  existingEmbeddedData: unknown,
  pageComments: unknown[],
): Record<string, unknown> => {
  const enriched: Record<string, unknown> =
    existingEmbeddedData && typeof existingEmbeddedData === "object"
      ? JSON.parse(JSON.stringify(existingEmbeddedData))
      : { site: { state: { relive: {} } } };

  const site =
    (enriched.site as Record<string, unknown> | undefined) ?? {};
  enriched.site = site;
  const state = (site.state as Record<string, unknown> | undefined) ?? {};
  site.state = state;
  const relive = (state.relive as Record<string, unknown> | undefined) ?? {};
  state.relive = relive;
  relive.comments = pageComments.map((comment) => {
    const data =
      typeof comment === "object" && comment !== null
        ? (comment as Record<string, unknown>).data
        : undefined;
    return typeof data === "object" && data !== null
      ? data
      : { comment: String(comment) };
  });

  return enriched;
};

/**
 * enriched embedded-dataからAgentComment[]を抽出する。
 */
const extractParsedComments = (enriched: unknown): unknown[] => {
  try {
    const enrichedRec = enriched as Record<string, unknown>;
    const site = enrichedRec.site as Record<string, unknown> | undefined;
    const state = site?.state as Record<string, unknown> | undefined;
    const relive = state?.relive as Record<string, unknown> | undefined;
    const parsedComments: unknown[] = (
      relive?.comments as Array<Record<string, unknown>> | undefined
    )?.map((commentData) => ({ data: commentData })) ?? [];
    return parsedComments;
  } catch {
    return [];
  }
};

/**
 * embedded-dataからWebSocket URLを取得する。
 */
export const getWebSocketUrlFromEmbeddedData = (
  data: unknown,
): string | undefined => {
  if (!data || typeof data !== "object") return undefined;

  const rec = data as Record<string, unknown>;

  const site = rec.site as Record<string, unknown> | undefined;
  if (site) {
    const state = site.state as Record<string, unknown> | undefined;
    if (state) {
      const relive = state.relive as Record<string, unknown> | undefined;
      if (relive && typeof relive.webSocketUrl === "string") {
        return relive.webSocketUrl;
      }
    }

    const relive = site.relive as Record<string, unknown> | undefined;
    if (relive && typeof relive.webSocketUrl === "string") {
      return relive.webSocketUrl;
    }

    if (typeof site.webSocketUrl === "string") {
      return site.webSocketUrl;
    }
  }

  const relive = rec.relive as Record<string, unknown> | undefined;
  if (relive && typeof relive.webSocketUrl === "string") {
    return relive.webSocketUrl;
  }

  if (typeof rec.webSocketUrl === "string") {
    return rec.webSocketUrl;
  }

  return undefined;
};

/**
 * embedded-dataからfrontendIdを取得する。
 */
export const getFrontendIdFromEmbeddedData = (
  data: unknown,
): string | undefined => {
  if (!data || typeof data !== "object") return undefined;

  const rec = data as Record<string, unknown>;

  const site = rec.site as Record<string, unknown> | undefined;
  if (site) {
    if (typeof site.frontendId === "number") return String(site.frontendId);
    if (typeof site.frontendId === "string" && site.frontendId.trim().length > 0)
      return site.frontendId.trim();

    const state = site.state as Record<string, unknown> | undefined;
    if (state) {
      if (typeof state.frontendId === "number")
        return String(state.frontendId);
      if (
        typeof state.frontendId === "string" &&
        state.frontendId.trim().length > 0
      )
        return state.frontendId.trim();
    }
  }

  if (typeof rec.frontendId === "number") return String(rec.frontendId);
  if (typeof rec.frontendId === "string" && rec.frontendId.trim().length > 0)
    return rec.frontendId.trim();

  return undefined;
};

/**
 * WebSocket URLにfrontend_idクエリパラメータを付与する。
 */
export const buildWebSocketUrlWithFrontendId = (
  webSocketUrl: string,
  frontendId: string,
): string | null => {
  try {
    const url = new URL(webSocketUrl);
    if (!url.searchParams.has("frontend_id")) {
      url.searchParams.set("frontend_id", frontendId);
    }
    return url.toString();
  } catch {
    return null;
  }
};

/**
 * embedded-dataからWebSocket URLを取得し、frontendIdも付与して返す。
 */
export const resolveWebSocketUrl = (
  embeddedData: unknown,
): string | undefined => {
  const wsUrl = getWebSocketUrlFromEmbeddedData(embeddedData);
  if (!wsUrl) return undefined;
  const frontendId = getFrontendIdFromEmbeddedData(embeddedData);
  if (frontendId) {
    const enriched = buildWebSocketUrlWithFrontendId(wsUrl, frontendId);
    return enriched ?? wsUrl;
  }
  return wsUrl;
};
