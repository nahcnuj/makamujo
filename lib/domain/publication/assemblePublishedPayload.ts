import { normalizePublishedStreamState } from "../../streamState";
import type { DisplayedStatistics } from "../broadcasting/watchPageStatistics";
import type {
  PublishedStreamPayload,
  StreamerPublicationSnapshot,
} from "./types";

export const GENERATED_SPEECH_HISTORY_SSE_SIZE = 20;

export type AssemblePublishedPayloadInput = {
  lastPublished: unknown;
  agentStreamState: unknown;
  /**
   * 配信ページの統計行から今回読んだ値。数値がある項目だけ
   * `lastPublished`（わんコメの POST /api/meta）より優先する。
   * ページに値が無い項目は PUT / POST の値を消さない。
   */
  displayedStatistics?: DisplayedStatistics;
  /**
   * ページが `-` で、PUT / POST にも無い項目に残す、直前の自己収集値。
   */
  retainedStatistics?: DisplayedStatistics;
  streamer: StreamerPublicationSnapshot;
  speechState: unknown;
  history: unknown[];
  historySseSize?: number;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;

const definedNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * ページの今回値 → PUT / POST にある値 → 直前の自己収集、の順で採る。
 * どれも無ければキーを出さない（無い値で上書きしない）。
 */
const pickProgramMetric = (
  current: number | undefined,
  fromPut: unknown,
  retained: number | undefined,
): number | undefined => current ?? definedNumber(fromPut) ?? retained;

const assignMetric = (
  total: Record<string, unknown>,
  key: string,
  value: number | undefined,
) => {
  if (value === undefined) {
    delete total[key];
    return;
  }
  total[key] = value;
};

/**
 * 配信ページが数値を出している統計だけ `niconama` に載せる。
 * タイトル / URL / 開始時刻 / 放送状態はページから取らないので触らない。
 * PUT / POST に無く、ページも `-` の項目は `retained` を残す。
 */
export const applyDisplayedStatistics = (
  niconama: unknown,
  statistics: DisplayedStatistics,
  retained?: DisplayedStatistics,
): unknown => {
  const base = asRecord(niconama) ?? {};
  const meta = asRecord(base.meta) ?? {};
  const total = { ...asRecord(meta.total) };
  assignMetric(
    total,
    "listeners",
    pickProgramMetric(statistics.viewers, total.listeners, retained?.viewers),
  );
  assignMetric(
    total,
    "gift",
    pickProgramMetric(statistics.giftPoints, total.gift, retained?.giftPoints),
  );
  assignMetric(
    total,
    "ad",
    pickProgramMetric(
      statistics.nicoadPoints,
      total.ad,
      retained?.nicoadPoints,
    ),
  );

  const next = {
    ...base,
    meta: {
      ...meta,
      total,
    },
  };
  if (
    Object.keys(base).length === 0 &&
    Object.keys(meta).length === 0 &&
    Object.keys(total).length === 0
  ) {
    return {};
  }
  return next;
};

const omitUndefined = (
  record: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );

const mergeTotal = (previous: unknown, next: unknown): unknown => {
  const prev = asRecord(previous);
  const incoming = asRecord(next);
  if (incoming === undefined) {
    return previous;
  }
  const merged = { ...(prev ?? {}), ...omitUndefined(incoming) };
  return Object.keys(merged).length > 0 ? merged : undefined;
};

const mergeNiconama = (previous: unknown, next: unknown): unknown => {
  const prev = asRecord(previous);
  const incoming = asRecord(next);
  if (incoming === undefined) {
    return previous;
  }
  if (prev === undefined) {
    return next;
  }
  const prevMeta = asRecord(prev.meta);
  const nextMeta = asRecord(incoming.meta);
  const meta =
    nextMeta === undefined
      ? prevMeta
      : {
          ...prevMeta,
          ...omitUndefined(nextMeta),
          total: mergeTotal(prevMeta?.total, nextMeta.total),
        };
  return {
    ...prev,
    ...omitUndefined(incoming),
    ...(meta === undefined ? {} : { meta }),
  };
};

/**
 * POST /api/meta が持っていない番組情報は消さない。
 * `niconama` が無い更新は直前の番組情報を残し、ある更新は定義された項目だけ上書きする。
 */
export const mergePublishedProgramInfo = (
  previous: unknown,
  next: unknown,
): unknown => {
  const prev = asRecord(previous);
  const incoming = asRecord(next);
  if (incoming === undefined) {
    return previous;
  }
  if (prev === undefined) {
    return next;
  }
  if (!("niconama" in incoming) || incoming.niconama === undefined) {
    return { ...incoming, niconama: prev.niconama };
  }
  return {
    ...incoming,
    niconama: mergeNiconama(prev.niconama, incoming.niconama),
  };
};

/**
 * Assemble the public stream payload (legacy `getCurrentStreamPayload` contract).
 *
 * Base selection: when lastPublished is null/undefined use agentStreamState; otherwise lastPublished only
 * for niconama (no merge of agent niconama into base). replyTarget falls back to agentBase.
 */
export const assemblePublishedPayload = (
  input: AssemblePublishedPayloadInput,
): PublishedStreamPayload => {
  const historySseSize =
    input.historySseSize ?? GENERATED_SPEECH_HISTORY_SSE_SIZE;
  const streamStateForBase =
    input.lastPublished === undefined || input.lastPublished === null
      ? input.agentStreamState
      : input.lastPublished;

  const normalizedStreamState =
    normalizePublishedStreamState(streamStateForBase);
  const base =
    normalizedStreamState && typeof normalizedStreamState === "object"
      ? (normalizedStreamState as Record<string, unknown>)
      : {};
  const normalizedAgentStreamState = normalizePublishedStreamState(
    input.agentStreamState,
  );
  const agentBase =
    normalizedAgentStreamState && typeof normalizedAgentStreamState === "object"
      ? (normalizedAgentStreamState as Record<string, unknown>)
      : {};

  const replyTargetComment =
    base.replyTargetComment && typeof base.replyTargetComment === "object"
      ? base.replyTargetComment
      : agentBase.replyTargetComment &&
          typeof agentBase.replyTargetComment === "object"
        ? agentBase.replyTargetComment
        : undefined;

  const speechHistorySource = Array.isArray(base.speechHistory)
    ? base.speechHistory
    : input.history;

  return {
    niconama:
      input.displayedStatistics === undefined
        ? (base.niconama ?? {})
        : applyDisplayedStatistics(
            base.niconama,
            input.displayedStatistics,
            input.retainedStatistics,
          ),
    canSpeak: (base.canSpeak as boolean | undefined) ?? input.streamer.canSpeak,
    currentGame: base.currentGame ?? input.streamer.currentGame ?? null,
    nGram:
      (base.nGram as number | undefined) ?? input.streamer.currentNGramSize,
    nGramRaw:
      (base.nGramRaw as number | undefined) ??
      input.streamer.currentNGramSizeRaw,
    speech: base.speech ?? input.speechState,
    speechHistory: speechHistorySource.slice(0, historySseSize),
    replyTargetComment:
      replyTargetComment as PublishedStreamPayload["replyTargetComment"],
    commentCount:
      input.displayedStatistics === undefined
        ? ((base.commentCount as number | undefined) ??
          input.streamer.commentCount)
        : (pickProgramMetric(
            input.displayedStatistics.comments,
            base.commentCount,
            input.retainedStatistics?.comments,
          ) ?? input.streamer.commentCount),
    previousStreamCommentCount:
      (base.previousStreamCommentCount as number | undefined) ??
      input.streamer.previousStreamCommentCount,
  } as const;
};

/**
 * Extract replyTargetComment and unwrap POST /api/meta body before normalize
 * (steps 2–3 of the meta pipeline; publish/normalize/persist stay in host).
 */
export const extractMetaPostBody = (
  body: unknown,
): {
  replyTargetComment: unknown;
  published: unknown;
} => {
  const replyTargetComment = (() => {
    if (body && typeof body === "object" && "replyTargetComment" in body) {
      return (body as Record<string, unknown>).replyTargetComment;
    }
    const nestedData =
      body && typeof body === "object" && "data" in body
        ? (body as Record<string, unknown>).data
        : undefined;
    if (
      nestedData &&
      typeof nestedData === "object" &&
      nestedData !== null &&
      "replyTargetComment" in nestedData
    ) {
      return (nestedData as Record<string, unknown>).replyTargetComment;
    }
    return undefined;
  })();

  let published: unknown = body;
  if (
    published &&
    typeof published === "object" &&
    !("type" in published) &&
    "data" in published
  ) {
    published = (published as Record<string, unknown>).data;
  }

  return { replyTargetComment, published };
};

/** Apply replyTarget onto normalized published value (meta pipeline step 6). */
export const attachReplyTargetToPublished = (
  published: unknown,
  replyTargetComment: unknown,
): unknown => {
  if (replyTargetComment === undefined) {
    return published;
  }
  if (published && typeof published === "object") {
    return { ...(published as object), replyTargetComment };
  }
  return { replyTargetComment };
};
