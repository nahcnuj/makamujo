/**
 * Production comment ingress from NicoNico live (in-process client).
 * origin/main removed external HTTP POST/PUT / comment routes (always 404).
 */
import {
  createNiconamaCommentClient,
  filterAgentCommentsWithText,
  getCommentTextFromAgentComment,
  type NiconamaCommentClient,
} from "../lib/niconamaCommentClient";
import {
  coerceToAgentComments,
  countNumberedAgentComments,
} from "../lib/niconamaCommentClient.helpers";

export type NiconamaCommentIngressDeps = {
  postComments: (comments: unknown) => void;
  /** Meta updates from the live page / websocket (title, listeners, …). */
  onMeta: (payload: unknown) => void;
  getCurrentStreamPayload: () => unknown;
  getLastPublished: () => unknown;
  setLastPublished: (value: unknown) => void;
  broadcastOnComment: () => void;
  /** Optional: persist talk model after comments (same as main). */
  persistTalkModel?: () => void;
  /** Called when start retries are exhausted (default: process.exit(1)). */
  onFatalStartFailure?: () => void;
};

export type NiconamaCommentIngressHandle = {
  stop: () => Promise<void>;
};

const getCommentCountFromPayload = (obj: unknown): number => {
  if (typeof obj !== "object" || obj === null) return 0;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.commentCount === "number") return rec.commentCount;
  const niconama = rec.niconama;
  if (typeof niconama !== "object" || niconama === null) return 0;
  const meta = (niconama as Record<string, unknown>).meta;
  if (typeof meta !== "object" || meta === null) return 0;
  const total = (meta as Record<string, unknown>).total;
  if (typeof total !== "object" || total === null) return 0;
  const comments = (total as Record<string, unknown>).comments;
  return typeof comments === "number" ? comments : 0;
};

export const buildNiconamaClientOptions = () => {
  const watchUrl =
    process.env.NICONAMA_WATCH_URL ?? process.env.NICONAMA_TEST_WATCH_URL;
  const userDataDir =
    process.env.NICONAMA_USER_DATA_DIR ?? "./playwright/.auth/";
  // Prefer explicit env; do not hardcode system Chromium (bundled Playwright default).
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;

  const options: Record<string, string | number | undefined> = {
    userDataDir,
    pollIntervalMs: 30_000,
  };
  if (executablePath && executablePath.length > 0) {
    options.executablePath = executablePath;
  }
  if (typeof watchUrl === "string" && watchUrl.length > 0) {
    options.watchUrl = watchUrl;
  }
  return options;
};

/**
 * Update last-published mirror after comments (commentCount / recentComments).
 * Pure enough to unit-test without starting the live client.
 */
export const applyNiconamaCommentsToPublishedState = (
  lastPublished: unknown,
  currentPayload: unknown,
  comments: unknown[],
): Record<string, unknown> => {
  const filteredComments = filterAgentCommentsWithText(
    coerceToAgentComments(comments),
  );
  const currentCount = getCommentCountFromPayload(currentPayload);
  const numberedCommentsCount = countNumberedAgentComments(filteredComments);
  const newCount = currentCount + numberedCommentsCount;

  const last: Record<string, unknown> =
    lastPublished && typeof lastPublished === "object"
      ? { ...(lastPublished as object) }
      : {};
  last.commentCount = newCount;

  const existingRecent = Array.isArray(last.recentComments)
    ? [...(last.recentComments as unknown[])]
    : [];
  last.recentComments = [...existingRecent, ...filteredComments];

  if (!last.niconama || typeof last.niconama !== "object") {
    last.niconama = { meta: { total: { comments: newCount } } };
  } else {
    const nico = { ...(last.niconama as object) } as Record<string, unknown>;
    const meta =
      typeof nico.meta === "object" && nico.meta !== null
        ? { ...(nico.meta as object) }
        : {};
    const metaRec = meta as Record<string, unknown>;
    const total =
      typeof metaRec.total === "object" && metaRec.total !== null
        ? { ...(metaRec.total as object) }
        : {};
    (total as Record<string, unknown>).comments = newCount;
    metaRec.total = total;
    nico.meta = metaRec;
    last.niconama = nico;
  }
  return last;
};

/**
 * Start the NicoNico comment client after a short delay (with retries).
 * Returns a stop() for process shutdown.
 *
 * - `NICONAMA_DISABLE=1` — do not start.
 * - `NICONAMA_START_MAX_RETRIES=0` — do not start, do not treat as fatal.
 * - Default max retries 3; on exhaustion calls onFatalStartFailure or exit(1).
 */
export function scheduleNiconamaCommentIngress(
  deps: NiconamaCommentIngressDeps,
): NiconamaCommentIngressHandle {
  let client: NiconamaCommentClient | null = null;
  let cancelled = false;
  const debugComments = process.env.DEBUG_NICONAMA_COMMENTS === "1";
  const disabled =
    process.env.NICONAMA_DISABLE === "1" ||
    process.env.NICONAMA_DISABLE === "true";

  const handleComments = (comments: unknown) => {
    const parsed = coerceToAgentComments(comments);
    const filteredComments = filterAgentCommentsWithText(parsed);
    if (debugComments) {
      for (const comment of filteredComments) {
        const text = getCommentTextFromAgentComment(comment);
        if (text) console.log("[NICONAMA COMMENT]", text);
      }
    }

    try {
      // Match origin/main: post full coerced list (not only text-bearing).
      deps.postComments(parsed);
    } catch (err) {
      console.warn(
        "[WARN] agent.postComments threw:",
        err instanceof Error ? err.message : String(err),
      );
    }

    try {
      const next = applyNiconamaCommentsToPublishedState(
        deps.getLastPublished(),
        deps.getCurrentStreamPayload(),
        parsed,
      );
      deps.setLastPublished(next);
    } catch (err) {
      console.warn(
        "[WARN] failed to update fallback commentCount:",
        err instanceof Error ? err.message : String(err),
      );
    }

    deps.broadcastOnComment();
    deps.persistTalkModel?.();
  };

  const createClient = () =>
    createNiconamaCommentClient(buildNiconamaClientOptions(), {
      onMeta: deps.onMeta,
      onComments: handleComments,
      onError: (err) => {
        console.warn(
          "[WARN] niconama comment client error:",
          err instanceof Error ? err.message : String(err),
        );
      },
    });

  if (disabled) {
    console.info(
      "[INFO] niconama comment client disabled (NICONAMA_DISABLE=1)",
    );
    return {
      stop: async () => {
        cancelled = true;
      },
    };
  }

  const startDelayMs = Number(process.env.NICONAMA_START_DELAY_MS ?? "350");
  const maxRetries = Number(process.env.NICONAMA_START_MAX_RETRIES ?? "3");

  // 0 or negative: skip automatic start without failing the process (CI / dry-run).
  if (!Number.isFinite(maxRetries) || maxRetries < 1) {
    console.info(
      "[INFO] niconama comment client not started (NICONAMA_START_MAX_RETRIES < 1)",
    );
    return {
      stop: async () => {
        cancelled = true;
      },
    };
  }

  setTimeout(async () => {
    let attempt = 0;
    while (!cancelled && attempt < maxRetries) {
      attempt += 1;
      try {
        client = createClient();
        await client.start();
        if (cancelled) {
          await client.stop().catch(() => {});
          client = null;
          return;
        }
        console.info("[INFO] niconamaCommentClient started successfully", {
          watchUrl:
            process.env.NICONAMA_WATCH_URL ??
            process.env.NICONAMA_TEST_WATCH_URL ??
            "unset",
        });
        return;
      } catch (err) {
        if (cancelled) return;
        console.warn(
          "[WARN] niconamaCommentClient start attempt failed:",
          err instanceof Error ? err.message : String(err),
          "attempt=",
          attempt,
        );
        if (attempt >= maxRetries) {
          console.error(
            "[ERROR] reached max retries for niconama start; treating as fatal",
          );
          if (deps.onFatalStartFailure) {
            deps.onFatalStartFailure();
          } else {
            process.exit(1);
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }, startDelayMs);

  return {
    stop: async () => {
      cancelled = true;
      if (!client) return;
      try {
        await client.stop();
      } catch (err) {
        console.warn(
          "[WARN] failed to stop niconamaCommentClient:",
          err instanceof Error ? err.message : String(err),
        );
      }
      client = null;
    },
  };
}
