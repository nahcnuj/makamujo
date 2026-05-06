const normalizeSpeechString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export const normalizePublishedStreamState = (rawState: unknown): unknown => {
  if (!rawState || typeof rawState !== 'object') {
    return rawState;
  }

  const state = rawState as Record<string, unknown>;

  if (state.type === 'niconama') {
    const data = state.data as Record<string, unknown> | undefined;
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
    return {
      niconama: {
        type: data?.isLive ? 'live' : 'offline',
        meta: {
          title: data?.title ?? undefined,
          url: data?.url ?? undefined,
          start: data?.startTime ?? undefined,
          total: Object.keys(total).length > 0 ? total : undefined,
        },
      },
    };
  }

  if ('niconama' in state && state.niconama && typeof state.niconama === 'object') {
    return state;
  }

  if (state.type === 'live' || state.type === 'offline') {
    return {
      niconama: state,
    };
  }

  return state;
};

export const normalizeSpeechText = (speech: unknown): string | undefined => {
  if (typeof speech === 'string') {
    return normalizeSpeechString(speech);
  }

  if (!speech || typeof speech !== 'object') {
    return undefined;
  }

  const record = speech as Record<string, unknown>;
  const textValue = normalizeSpeechString(record.text);
  if (textValue !== undefined) {
    return textValue;
  }

  const speechValue = record.speech;
  if (typeof speechValue === 'string') {
    return normalizeSpeechString(speechValue);
  }

  if (speechValue && typeof speechValue === 'object') {
    return normalizeSpeechText(speechValue);
  }

  return undefined;
};
