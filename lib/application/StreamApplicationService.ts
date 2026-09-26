import {
  isCommentsStale,
  shouldPromptCommentAfterViewerIncrease,
} from "../domain/broadcasting/SilencePolicy";
import { COMMENT_PROMPT_TEXT } from "../domain/comments/SystemSpeechScripts";
import type { AgentSession } from "./AgentSession";
import type { SpeechQueue } from "./SpeechQueue";
import type { StreamBaseline } from "./streamBaselineStore";
import type { SpeechPort, StreamData } from "./types";

export type StreamApplicationServiceOptions = {
  silenceThresholdMs: number;
  onBaselineChange?: (baseline: StreamBaseline) => void;
};

/** 値が undefined のキーを落として、表示側が `-` を出せるようにする。 */
const withDefinedKeys = <T extends Record<string, number | undefined>>(
  value: T,
) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };

/**
 * Broadcasting-side use cases: onAir, program URL, silence clocks, comment prompt.
 */
export class StreamApplicationService {
  #session: AgentSession;
  #speech: SpeechPort;
  #speechQueue: SpeechQueue;
  #silenceThresholdMs: number;
  #onBaselineChange?: (baseline: StreamBaseline) => void;

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
    this.#onBaselineChange = options.onBaselineChange;
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
          comments,
          points,
        } = streamData.data;
        if (isLive) {
          if (this.#session.currentProgramUrl !== url) {
            // The previous live program ended without an observed offline
            // state (niconama switches between live URLs directly). Carry its
            // final comment count over so `previousStreamCommentCount` keeps
            // advancing instead of staying 0.
            if (this.#session.currentProgramLatestCommentNo > 0) {
              this.#session.previousStreamCommentCount =
                this.#session.currentProgramLatestCommentNo;
            }
            this.#session.currentProgramUrl = url;
            this.#session.currentProgramLatestCommentNo = 0;
            this.#session.hasPromptedCommentForViewerIncrease = false;
            this.#onBaselineChange?.(this.#session.toStreamBaseline());
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
          this.#session.previousStreamCommentCount =
            this.#session.currentProgramLatestCommentNo;
          this.#session.lastListenerCount = undefined;
          this.#session.listenersStaleSince = undefined;
          this.#session.currentProgramUrl = undefined;
          this.#session.currentProgramLatestCommentNo = 0;
          this.#onBaselineChange?.(this.#session.toStreamBaseline());
        }

        this.#session.streamState = isLive
          ? {
              type: "live",
              meta: {
                title,
                start,
                url,
                // ページに値が無い項目はキーを落とさない（表示側が `-` を出す）。
                total: withDefinedKeys({
                  listeners,
                  gift: points?.gift,
                  ad: points?.ad,
                  comments:
                    comments ?? this.#session.currentProgramLatestCommentNo,
                }),
              },
            }
          : undefined;
        break;
      }
    }
  }
}
