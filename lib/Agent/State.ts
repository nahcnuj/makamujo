import type { StreamState as AGTStreamState } from "automated-gameplay-transmitter";

export type StreamMeta = {
  title: string;
  url: string;
  start: number;
  /** 配信ページが値を出していない項目は undefined のまま（表示は `-`）。 */
  total?: {
    listeners?: number;
    gift?: number;
    ad?: number;
    comments?: number;
  };
};

export type StreamState = AGTStreamState;

export type ReplyTargetComment = {
  text: string;
  pickedTopic: string;
};

export type AgentState = StreamState & {
  meta?: StreamMeta;
  replyTargetComment?: ReplyTargetComment;
  previousStreamCommentCount?: number;
};
