import { normalizePublishedStreamState } from "../../streamState";
import type { PublishedStreamPayload, StreamerPublicationSnapshot } from "./types";

export const GENERATED_SPEECH_HISTORY_SSE_SIZE = 20;

export type AssemblePublishedPayloadInput = {
  lastPublished: unknown;
  agentStreamState: unknown;
  streamer: StreamerPublicationSnapshot;
  speechState: unknown;
  history: unknown[];
  historySseSize?: number;
};

/**
 * Assemble the public stream payload (legacy `getCurrentStreamPayload` contract).
 *
 * Base selection: when lastPublished is null/undefined use agentStreamState; otherwise lastPublished only
 * for niconama (no merge of agent niconama into base). replyTarget falls back to agentBase.
 */
export const assemblePublishedPayload = (input: AssemblePublishedPayloadInput): PublishedStreamPayload => {
  const historySseSize = input.historySseSize ?? GENERATED_SPEECH_HISTORY_SSE_SIZE;
  const streamStateForBase =
    (input.lastPublished === undefined || input.lastPublished === null)
      ? input.agentStreamState
      : input.lastPublished;

  const normalizedStreamState = normalizePublishedStreamState(streamStateForBase);
  const base = normalizedStreamState && typeof normalizedStreamState === "object"
    ? (normalizedStreamState as Record<string, unknown>)
    : {};
  const normalizedAgentStreamState = normalizePublishedStreamState(input.agentStreamState);
  const agentBase = normalizedAgentStreamState && typeof normalizedAgentStreamState === "object"
    ? (normalizedAgentStreamState as Record<string, unknown>)
    : {};

  const replyTargetComment = base.replyTargetComment && typeof base.replyTargetComment === "object"
    ? base.replyTargetComment
    : agentBase.replyTargetComment && typeof agentBase.replyTargetComment === "object"
      ? agentBase.replyTargetComment
      : undefined;

  const speechHistorySource = Array.isArray(base.speechHistory) ? base.speechHistory : input.history;

  return {
    niconama: base.niconama ?? {},
    canSpeak: (base.canSpeak as boolean | undefined) ?? input.streamer.canSpeak,
    currentGame: base.currentGame ?? input.streamer.currentGame ?? null,
    nGram: (base.nGram as number | undefined) ?? input.streamer.currentNGramSize,
    nGramRaw: (base.nGramRaw as number | undefined) ?? input.streamer.currentNGramSizeRaw,
    speech: base.speech ?? input.speechState,
    speechHistory: speechHistorySource.slice(0, historySseSize),
    replyTargetComment: replyTargetComment as PublishedStreamPayload["replyTargetComment"],
    commentCount: (base.commentCount as number | undefined) ?? input.streamer.commentCount,
  } as const;
};

/**
 * Extract replyTargetComment and unwrap POST /api/meta body before normalize
 * (steps 2–3 of the meta pipeline; publish/normalize/persist stay in host).
 */
export const extractMetaPostBody = (body: unknown): {
  replyTargetComment: unknown;
  published: unknown;
} => {
  const replyTargetComment = (() => {
    if (body && typeof body === "object" && "replyTargetComment" in body) {
      return (body as Record<string, unknown>).replyTargetComment;
    }
    const nestedData = body && typeof body === "object" && "data" in body
      ? (body as Record<string, unknown>).data
      : undefined;
    if (nestedData && typeof nestedData === "object" && nestedData !== null && "replyTargetComment" in nestedData) {
      return (nestedData as Record<string, unknown>).replyTargetComment;
    }
    return undefined;
  })();

  let published: unknown = body;
  if (published && typeof published === "object" && !("type" in published) && "data" in published) {
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
