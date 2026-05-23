export const normalizePublishedStreamState = (state: unknown): unknown => {
  if (!state || typeof state !== 'object') {
    return state;
  }

  const rawState = state as Record<string, unknown>;

  // Preserve any top-level custom fields while normalizing legacy payloads.
  // This is important for values like replyTargetComment, commentCount, and
  // speechHistory that are not part of the legacy `type/data` structure.
  if (rawState.type === 'niconama') {
    const data = rawState.data as Record<string, unknown> | undefined;
    const total: Record<string, unknown> = {};
    if (typeof data?.total === 'number') {
      total.listeners = data.total;
    }
    if (data?.points && typeof (data.points as Record<string, unknown>).gift !== 'undefined') {
      total.gift = (data.points as Record<string, unknown>).gift;
    }
    if (data?.points && typeof (data.points as Record<string, unknown>).ad !== 'undefined') {
      total.ad = (data.points as Record<string, unknown>).ad;
    }

    const normalizedState: Record<string, unknown> = { ...rawState };
    delete normalizedState.type;
    delete normalizedState.data;
    normalizedState.niconama = {
      type: data?.isLive ? 'live' : 'offline',
      meta: {
        title: data?.title ?? undefined,
        url: data?.url ?? undefined,
        start: data?.startTime ?? undefined,
        total: Object.keys(total).length > 0 ? total : undefined,
      },
    };
    return normalizedState;
  }

  if ('niconama' in rawState && rawState.niconama && typeof rawState.niconama === 'object') {
    return rawState;
  }

  if (rawState.type === 'live' || rawState.type === 'offline') {
    const normalizedState: Record<string, unknown> = { ...rawState };
    delete normalizedState.type;
    normalizedState.niconama = rawState;
    return normalizedState;
  }

  return rawState;
};

/**
 * Normalize various payload shapes into a consistent `niconama` object where
 * `niconama.meta` contains `title`, `url`, and `start` when those values are
 * present either at top-level or within a `niconama` object that lacks `meta`.
 */
export const resolveNiconamaFromState = (src: unknown): unknown => {
  if (!src || typeof src !== 'object') return {};

  const payload = src as any;

  if (payload.niconama && typeof payload.niconama === 'object') {
    const n = { ...payload.niconama } as any;
    if ((!n.meta || typeof n.meta !== 'object') && (n.title || n.url || n.start || n.startTime)) {
      n.meta = {
        title: typeof n.title === 'string' ? n.title : undefined,
        url: typeof n.url === 'string' ? n.url : undefined,
        start: typeof n.start === 'number' ? n.start : (typeof n.startTime === 'number' ? n.startTime : undefined),
        total: n.meta?.total ?? n.total ?? undefined,
      } as any;
    }
    return n;
  }

  const hasTopLevelFields = typeof payload.title === 'string' || typeof payload.url === 'string' || typeof payload.start === 'number' || typeof payload.startTime === 'number';
  if (hasTopLevelFields) {
    return {
      type: typeof payload.type === 'string' ? payload.type : undefined,
      meta: {
        title: typeof payload.title === 'string' ? payload.title : undefined,
        url: typeof payload.url === 'string' ? payload.url : undefined,
        start: typeof payload.start === 'number' ? payload.start : (typeof payload.startTime === 'number' ? payload.startTime : undefined),
        total: payload.meta?.total ?? payload.total ?? undefined,
      },
    } as any;
  }

  // If the payload embeds stream-like metadata inside `currentGame.state`,
  // promote it into a `niconama.meta`-like structure so consumers that expect
  // `niconama.meta.title/url/start` can still display stream info even when
  // the upstream source placed those values under the current game state.
  try {
    const cg = payload.currentGame;
    const gameState = cg && typeof cg === 'object' && cg.state && typeof cg.state === 'object' ? cg.state : undefined;
    if (gameState) {
      const title = typeof gameState.title === 'string' ? gameState.title : undefined;
      const url = typeof gameState.url === 'string' ? gameState.url : undefined;
      const start = typeof gameState.timestamp === 'number' ? gameState.timestamp : (typeof gameState.start === 'number' ? gameState.start : undefined);
      if (title || url || typeof start === 'number') {
        return {
          type: typeof payload.type === 'string' ? payload.type : undefined,
          meta: {
            title,
            url,
            start,
            total: payload.meta?.total ?? payload.total ?? undefined,
          },
        } as any;
      }
    }
  } catch {
    // ignore and fall through to empty
  }

  return {};
};
