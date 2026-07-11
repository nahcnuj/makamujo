import {
  isCommentsStale,
  shouldPromptCommentAfterViewerIncrease,
} from "../domain/broadcasting/SilencePolicy";
import { COMMENT_PROMPT_TEXT } from "../domain/comments/SystemSpeechScripts";
import type { AgentSession } from "./AgentSession";
import type { SpeechQueue } from "./SpeechQueue";
import type { SpeechPort, StreamData } from "./types";

export type StreamApplicationServiceOptions = {
  silenceThresholdMs: number;
};

/**
 * Broadcasting-side use cases: onAir, program URL, silence clocks, comment prompt.
 */
export class StreamApplicationService {
  #session: AgentSession;
  #speech: SpeechPort;
  #speechQueue: SpeechQueue;
  #silenceThresholdMs: number;

  constructor(
    session: AgentSession,
    speech: SpeechPort,
    speechQueue: SpeechQueue,
    options: StreamApplicationServiceOptions,
  ) {
    this.#session = session;
    this.#speech = speech;
    this.#speechQueue = speechQueue;
    this.#silenceThresholdMs = options.silenceThresholdMs;
  }

  onAir(state: StreamData | unknown): void {
    const streamData = state as StreamData | undefined;
    switch (streamData?.type) {
      case "niconama": {
        const {
          isLive,
          title,
          startTime: start,
          url,
          total: listeners,
          points,
        } = streamData.data;
        if (isLive) {
          if (this.#session.currentProgramUrl !== url) {
            this.#session.currentProgramUrl = url;
            this.#session.currentProgramLatestCommentNo = 0;
            this.#session.hasPromptedCommentForViewerIncrease = false;
          }

          if (this.#session.lastListenerCount !== listeners) {
            this.#session.lastListenerCount = listeners;
            this.#session.listenersStaleSince = new Date(Date.now());
            const now = Date.now();
            const commentsStale = isCommentsStale(
              this.#session.lastCommentAt,
              now,
              this.#silenceThresholdMs,
            );
            const hadCommentBefore = this.#session.lastCommentAt !== undefined;
            if (
              shouldPromptCommentAfterViewerIncrease({
                hadCommentBefore,
                commentsStale,
                hasPromptedCommentForViewerIncrease:
                  this.#session.hasPromptedCommentForViewerIncrease,
              })
            ) {
              this.#session.hasPromptedCommentForViewerIncrease = true;
              const promptText = COMMENT_PROMPT_TEXT;
              const clearOnError = (text: string, err: unknown) => {
                if (text === promptText) {
                  const msg = err instanceof Error ? err.message : String(err);
                  console.error("[ERROR]", "prompting comment failed", msg);
                  this.#session.hasPromptedCommentForViewerIncrease = false;
                  this.#speechQueue.removeTtsErrorHandler(clearOnError);
                }
              };
              this.#speechQueue.onTtsError(clearOnError);
              void this.#speech.speech(promptText);
            }
          }
        } else {
          this.#session.lastListenerCount = undefined;
          this.#session.listenersStaleSince = undefined;
          this.#session.currentProgramUrl = undefined;
          this.#session.currentProgramLatestCommentNo = 0;
        }

        this.#session.streamState = isLive
          ? {
              type: "live",
              meta: {
                title,
                start,
                url,
                total: {
                  listeners,
                  gift:
                    typeof points?.gift === "string"
                      ? Number.parseFloat(points.gift)
                      : points?.gift,
                  ad:
                    typeof points?.ad === "string"
                      ? Number.parseFloat(points.ad)
                      : points?.ad,
                  comments: this.#session.currentProgramLatestCommentNo,
                },
              },
            }
          : undefined;
        break;
      }
    }
  }
}
