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
