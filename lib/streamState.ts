export const normalizePublishedStreamState = (state: unknown): unknown => {
  if (!state || typeof state !== "object") {
    return state;
  }

  const rawState = state as Record<string, unknown>;

  // Preserve any top-level custom fields while normalizing legacy payloads.
  // This is important for values like replyTargetComment, commentCount, and
  // speechHistory that are not part of the legacy `type/data` structure.
  if (rawState.type === "niconama") {
    const data = rawState.data as Record<string, unknown> | undefined;
    const total: Record<string, unknown> = {};
    if (typeof data?.total === "number") {
      total.listeners = data.total;
    } else if (data?.total && typeof data.total === "object") {
      const totalObj = data.total as Record<string, unknown>;
      if (typeof totalObj.listeners === "number")
        total.listeners = totalObj.listeners;
      if (typeof totalObj.comments === "number")
        total.comments = totalObj.comments;
      if (typeof totalObj.gift === "number") total.gift = totalObj.gift;
      if (typeof totalObj.ad === "number") total.ad = totalObj.ad;
    }
    if (typeof data?.comments === "number") {
      total.comments = data.comments;
    }
    if (
      data?.points &&
      typeof (data.points as Record<string, unknown>).gift !== "undefined"
    ) {
      total.gift = (data.points as Record<string, unknown>).gift;
    }
    if (
      data?.points &&
      typeof (data.points as Record<string, unknown>).ad !== "undefined"
    ) {
      total.ad = (data.points as Record<string, unknown>).ad;
    }

    const normalizedState: Record<string, unknown> = { ...rawState };
    delete normalizedState.type;
    delete normalizedState.data;
    normalizedState.niconama = {
      type: data?.isLive ? "live" : "offline",
      meta: {
        title: data?.title ?? undefined,
        url: data?.url ?? undefined,
        start: data?.startTime ?? undefined,
        total: Object.keys(total).length > 0 ? total : undefined,
      },
    };
    return normalizedState;
  }

  if (
    "niconama" in rawState &&
    rawState.niconama &&
    typeof rawState.niconama === "object"
  ) {
    try {
      const resolved = resolveNiconamaFromState({
        niconama: rawState.niconama,
      });
      if (resolved && typeof resolved === "object") {
        return { ...rawState, niconama: resolved };
      }
    } catch {
      // fall through to return rawState unchanged
    }
    return rawState;
  }

  if (rawState.type === "live" || rawState.type === "offline") {
    const normalizedState: Record<string, unknown> = { ...rawState };
    delete normalizedState.type;
    normalizedState.niconama = rawState;
    return normalizedState;
  }

  return rawState;
};

// Type definitions for payload structures with stream metadata
interface StreamMetaOutput {
  title: string | undefined;
  url: string | undefined;
  start: number | undefined;
  total?: unknown;
}

interface NiconamaOutput {
  meta?: StreamMetaOutput;
  [key: string]: unknown;
}

interface StructuredOutput {
  type?: string;
  meta: StreamMetaOutput;
  [key: string]: unknown;
}

/**
 * Normalize various payload shapes into a consistent `niconama` object where
 * `niconama.meta` contains `title`, `url`, and `start` when those values are
 * present either at top-level or within a `niconama` object that lacks `meta`.
 */
export const resolveNiconamaFromState = (src: unknown): unknown => {
  if (!src || typeof src !== "object") return {};

  const payload = src as Record<string, unknown>;

  if (payload.niconama && typeof payload.niconama === "object") {
    const n: NiconamaOutput = {
      ...((payload.niconama as Record<string, unknown>) ?? {}),
    };
    const niconamaRecord = payload.niconama as Record<string, unknown>;

    if (
      (!n.meta || typeof n.meta !== "object") &&
      (niconamaRecord.title ||
        niconamaRecord.url ||
        niconamaRecord.start ||
        niconamaRecord.startTime)
    ) {
      const metaRecord = n.meta as Record<string, unknown> | undefined;
      n.meta = {
        title:
          typeof niconamaRecord.title === "string"
            ? (niconamaRecord.title as string)
            : undefined,
        url:
          typeof niconamaRecord.url === "string"
            ? (niconamaRecord.url as string)
            : undefined,
        start:
          typeof niconamaRecord.start === "number"
            ? (niconamaRecord.start as number)
            : typeof niconamaRecord.startTime === "number"
              ? (niconamaRecord.startTime as number)
              : undefined,
        total: metaRecord?.total ?? niconamaRecord.total,
      };
    }
    return n;
  }

  const hasTopLevelFields =
    typeof payload.title === "string" ||
    typeof payload.url === "string" ||
    typeof payload.start === "number" ||
    typeof payload.startTime === "number";
  if (hasTopLevelFields) {
    const result: StructuredOutput = {
      type:
        typeof payload.type === "string" ? (payload.type as string) : undefined,
      meta: {
        title:
          typeof payload.title === "string"
            ? (payload.title as string)
            : undefined,
        url:
          typeof payload.url === "string" ? (payload.url as string) : undefined,
        start:
          typeof payload.start === "number"
            ? (payload.start as number)
            : typeof payload.startTime === "number"
              ? (payload.startTime as number)
              : undefined,
        total:
          (payload.meta as Record<string, unknown> | undefined)?.total ??
          payload.total,
      },
    };
    return result;
  }

  // If the payload embeds stream-like metadata inside `currentGame.state`,
  // promote it into a `niconama.meta`-like structure so consumers that expect
  // `niconama.meta.title/url/start` can still display stream info even when
  // the upstream source placed those values under the current game state.
  try {
    const cg = payload.currentGame;
    const gameState =
      cg &&
      typeof cg === "object" &&
      (cg as Record<string, unknown>).state &&
      typeof (cg as Record<string, unknown>).state === "object"
        ? ((cg as Record<string, unknown>).state as Record<string, unknown>)
        : undefined;
    if (gameState) {
      const title =
        typeof gameState.title === "string"
          ? (gameState.title as string)
          : undefined;
      const url =
        typeof gameState.url === "string"
          ? (gameState.url as string)
          : undefined;
      const start =
        typeof gameState.timestamp === "number"
          ? (gameState.timestamp as number)
          : typeof gameState.start === "number"
            ? (gameState.start as number)
            : undefined;
      if (title || url || typeof start === "number") {
        const result: StructuredOutput = {
          type:
            typeof payload.type === "string"
              ? (payload.type as string)
              : undefined,
          meta: {
            title,
            url,
            start,
            total:
              (payload.meta as Record<string, unknown> | undefined)?.total ??
              payload.total,
          },
        };
        return result;
      }
    }
  } catch {
    // ignore and fall through to empty
  }

  return {};
};
