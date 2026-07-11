/** Shared stream / comment payload shapes used by application services. */

export type StreamData =
  | {
    type: "niconama";
    data: {
      title: string;
      isLive: boolean;
      startTime: number;
      total: number;
      points: {
        gift: number | string;
        ad: number | string;
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

export type TalkModelGenerateResult = string | { text: string; nodes?: string[] };

export type TalkModelPort = {
  generate(start?: string, nGram?: number): TalkModelGenerateResult;
  learn(text: string): void;
};

export type SpeechPort = {
  speech(generated?: TalkModelGenerateResult): Promise<void>;
};
