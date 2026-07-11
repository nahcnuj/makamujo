import type { ReplyTargetComment, StreamMeta } from "../../Agent/State";

/** onAir / MakaMujo.streamState — agent-internal (offline = undefined). */
export type AgentInternalStreamState = {
  type: "live";
  meta?: StreamMeta;
  replyTargetComment?: ReplyTargetComment;
};

/**
 * GET /api/meta, SSE, WS — public shape (aligns with console AgentStateResponse).
 */
export type PublishedStreamPayload = {
  niconama: unknown;
  canSpeak: boolean;
  currentGame: unknown | null;
  nGram: number;
  nGramRaw: number;
  speech: unknown;
  speechHistory: unknown[];
  replyTargetComment?: ReplyTargetComment;
  commentCount?: number;
};

export type StreamerPublicationSnapshot = {
  canSpeak: boolean;
  currentGame: unknown | null | undefined;
  currentNGramSize: number;
  currentNGramSizeRaw: number;
  commentCount?: number;
};
