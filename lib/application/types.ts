/** Shared stream / comment payload shapes used by application services. */

export type StreamData = {
  type: "niconama";
  data: {
    title: string;
    isLive: boolean;
    startTime: number;
    /** 視聴者数。ページに値が無いときは undefined。 */
    total?: number;
    /** コメント数。ページに値が無いときは undefined。 */
    comments?: number;
    /** ニコニコ広告 / ギフトのポイント。ページに値が無いときは undefined。 */
    points?: {
      gift?: number;
      ad?: number;
    };
    url: string;
  };
};

export type CommentData = {
  comment: string;
  no?: number;
  isOwner?: boolean;
  anonymity: boolean;
  name?: string;
  userId?: string;
  hasGift: boolean;
};

export type TalkModelGenerateResult =
  | string
  | { text: string; nodes?: string[] };

export type TalkModelPort = {
  generate(start?: string, nGram?: number): TalkModelGenerateResult;
  learn(text: string): void;
  unlearn(text: string): void;
};

export type SpeechPort = {
  speech(generated?: TalkModelGenerateResult): Promise<void>;
};
