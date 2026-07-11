/** Fixed system utterance scripts (Comment domain, pure constants + helpers). */

export const CRUISE_QUOTE_START_COMMENT = "「生放送クルーズさん」が引用を開始しました";
export const STREAM_END_ONE_MINUTE_COMMENT = "配信終了1分前です";
export const COMMENT_PROMPT_TEXT = "コメントしていってね〜";

export const CRUISE_WELCOME_SPEECHES = [
  "生放送クルーズのみなさん、こんにちは",
  "AI Vチューバーの馬可無序です",
  "コメントを学習してお話ししています",
  "ぜひ上のリンクから遊びに来てね",
] as const;

export const STREAM_END_SPEECHES = [
  "そろそろお別れのお時間です",
  "ご視聴、コメント、広告、ギフト、皆様ありがとうございました！",
  "AI Vチューバーの馬可無序がお送りしました",
  "次回の配信もお楽しみに！",
] as const;

export const isCruiseQuoteStart = (rawComment: string): boolean =>
  rawComment === CRUISE_QUOTE_START_COMMENT;

export const isStreamEndOneMinute = (rawComment: string): boolean =>
  rawComment === STREAM_END_ONE_MINUTE_COMMENT;

export const isAdCompletedComment = (rawComment: string): boolean =>
  rawComment.endsWith("広告しました");

/** Extract advertiser display name from ad system comment (legacy slice rules). */
export const extractAdName = (rawComment: string): string => {
  return rawComment.slice(rawComment.indexOf("】") + "】".length, rawComment.lastIndexOf("さんが"));
};

export const formatAdThanks = (name: string): string => `${name}さん、広告ありがとうございます！`;

export const formatGiftThanks = (name: string | undefined, anonymity: boolean): string => {
  if (anonymity) {
    return "ギフトありがとうございます！";
  }
  return `${name}さん、ギフトありがとうございます！`;
};
