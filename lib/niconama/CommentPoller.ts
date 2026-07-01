import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentComment } from "automated-gameplay-transmitter";
import { parseAgentCommentsFromResponseBody } from "../niconamaCommentClient.helpers";
import type { SeenCommentTracker } from "./SeenCommentTracker";

type CommentPollerOptions = {
  watchUrl: string;
  seenTracker: SeenCommentTracker;
};

/**
 * ニコ生のREST APIポーリングでコメントを取得するモジュール。
 *
 * embedded-dataからAPI URLを導出し、複数の候補URLを試みる。
 */
export class CommentPoller {
  readonly #seenTracker: SeenCommentTracker;
  readonly #watchUrl: string;

  constructor(options: CommentPollerOptions) {
    this.#seenTracker = options.seenTracker;
    this.#watchUrl = options.watchUrl;
  }

  /**
   * embedded-dataから導出できるポーリングAPIエンドポイントを試してコメントを取得する。
   */
  async fetchComments(embeddedData: unknown): Promise<AgentComment[]> {
    try {
      const candidates = this.#buildCandidateUrls(embeddedData);
      return await this.#tryCandidates(candidates);
    } catch {
      return [];
    }
  }

  #buildCandidateUrls(embeddedData: unknown): {
    priority: string[];
    regular: string[];
  } {
    const site: Record<string, unknown> =
      embeddedData && typeof embeddedData === "object"
        ? ((embeddedData as Record<string, unknown>).site as Record<
            string,
            unknown
          >) || {}
        : {};
    const program: Record<string, unknown> =
      embeddedData && typeof embeddedData === "object"
        ? ((embeddedData as Record<string, unknown>).program as Record<
            string,
            unknown
          >) || {}
        : {};

    let derivedProgramId: string | undefined =
      (typeof program.nicoliveProgramId === "string"
        ? program.nicoliveProgramId
        : undefined) ??
      (typeof program.programId === "string" ? program.programId : undefined) ??
      undefined;

    const pollingApiBase: string | undefined =
      (typeof site.pollingApiBaseUrl === "string"
        ? site.pollingApiBaseUrl
        : undefined) ||
      (typeof site.frontendPublicApiUrl === "string"
        ? site.frontendPublicApiUrl
        : undefined) ||
      (typeof site.apiBaseUrl === "string" ? site.apiBaseUrl : undefined) ||
      (typeof site.staticResourceBaseUrl === "string"
        ? site.staticResourceBaseUrl
        : undefined);

    const frontendApiBase: string | undefined =
      (typeof site.frontendPublicApiUrl === "string"
        ? site.frontendPublicApiUrl
        : undefined) ||
      (typeof site.apiBaseUrl === "string" ? site.apiBaseUrl : undefined);

    if (!derivedProgramId) {
      // watchUrlからprogramIdを導出
      const watchUrlMatch = /lv(\d{4,})/i.exec(this.#watchUrl);
      if (watchUrlMatch) {
        derivedProgramId = `lv${watchUrlMatch[1]}`;
      }
      const watchUrlMatch2 = /watch\/(lv\d+)/i.exec(this.#watchUrl);
      if (watchUrlMatch2) {
        derivedProgramId = watchUrlMatch2[1];
      }
    }

    const programId =
      derivedProgramId ??
      ((program as Record<string, unknown>).watchPageUrl
        ? /lv\d+/.exec(
            (program as Record<string, unknown>).watchPageUrl as string,
          )?.[0]
        : undefined) ??
      undefined;

    const priority: string[] = [];
    const regular: string[] = [];

    if (programId) {
      priority.push(
        `https://papi.live.nicovideo.jp/programs/${programId}/comments?limit=50`,
        `https://papi.live.nicovideo.jp/programs/${programId}/comments`,
        `https://papi.live.nicovideo.jp/v1/programs/${programId}/comments`,
        `https://papi.live.nicovideo.jp/comments?program_id=${programId}&limit=50`,
        `https://live.nicovideo.jp/api/programs/${programId}/comments`,
      );
    }

    if (pollingApiBase && programId) {
      regular.push(
        `${String(pollingApiBase).replace(/\/$/, "")}/programs/${programId}/comments?limit=50`,
        `${String(pollingApiBase).replace(/\/$/, "")}/programs/${programId}/comments`,
        `${String(pollingApiBase).replace(/\/$/, "")}/v1/programs/${programId}/comments`,
      );
    }

    if (frontendApiBase && programId) {
      regular.push(
        `${String(frontendApiBase).replace(/\/$/, "")}/programs/${programId}/comments`,
        `${String(frontendApiBase).replace(/\/$/, "")}/programs/${programId}/comments?limit=50`,
      );
    }

    if (pollingApiBase) {
      regular.push(
        `${String(pollingApiBase).replace(/\/$/, "")}/comments?limit=50`,
        `${String(pollingApiBase).replace(/\/$/, "")}/comments`,
      );
    }

    return { priority, regular };
  }

  async #tryCandidates(candidates: {
    priority: string[];
    regular: string[];
  }): Promise<AgentComment[]> {
    const diagnosticsDir = mkdtempSync(join(tmpdir(), "makamujo-polling-"));

    const tryFetchCandidate = async (
      url: string,
      timeoutMs: number,
    ): Promise<unknown | null> => {
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
          try {
            writeFileSync(
              join(diagnosticsDir, `${safeName}_${status}.txt`),
              `URL: ${url}\nSTATUS: ${status}\n\n${bodyText ?? ""}`,
            );
          } catch {}
        } catch {}
        if (!res || res.status >= 400) return null;
        const json = await res.json().catch(() => null);
        return json;
      } catch (err) {
        clearTimeout(id);
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

    // 優先候補を試す
    for (const url of candidates.priority) {
      try {
        const json = await tryFetchCandidate(url, 10_000);
        if (json) {
          const parsedComments = parseAgentCommentsFromResponseBody(
            json,
            this.#seenTracker.set,
          );
          if (parsedComments.length > 0) return parsedComments;
        }
        const json2 = await tryFetchCandidate(url, 8_000);
        if (json2) {
          const parsedComments2 = parseAgentCommentsFromResponseBody(
            json2,
            this.#seenTracker.set,
          );
          if (parsedComments2.length > 0) return parsedComments2;
        }
      } catch {}
    }

    // 通常候補を試す
    for (const url of candidates.regular) {
      try {
        const json = await tryFetchCandidate(url, 5_000);
        if (json) {
          const parsedComments = parseAgentCommentsFromResponseBody(
            json,
            this.#seenTracker.set,
          );
          if (parsedComments.length > 0) return parsedComments;
        }
      } catch {}
    }

    return [];
  }
}
