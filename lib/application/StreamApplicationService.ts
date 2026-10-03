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
  /**
   * Resolve the final comment count of the program that just ended. Defaults
   * to the in-memory counter alone; `MakaMujo` injects a resolver that also
   * reads the recorded comments so a restart cannot lose the count (#671).
   */
  resolvePreviousCommentCount?: (
    endedProgramUrl: string | undefined,
    inMemoryCount: number,
    incomingProgramUrl: string | undefined,
  ) => number;
};

/**
 * Broadcasting-side use cases: onAir, program URL, silence clocks, comment prompt.
 */
export class StreamApplicationService {
  #session: AgentSession;
  #speech: SpeechPort;
  #speechQueue: SpeechQueue;
  #silenceThresholdMs: number;
  #onBaselineChange?: (baseline: StreamBaseline) => void;
  #resolvePreviousCommentCount: (
    endedProgramUrl: string | undefined,
    inMemoryCount: number,
    incomingProgramUrl: string | undefined,
  ) => number;

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
    this.#resolvePreviousCommentCount =
      options.resolvePreviousCommentCount ??
      ((_endedProgramUrl, inMemoryCount) => inMemoryCount);
  }

  /**
   * Final comment count of the program that just ended, resolved through the
   * injected resolver (see {@link StreamApplicationServiceOptions}).
   */
  #resolveEndedProgramCommentCount(incomingProgramUrl: string): number {
    const resolved = this.#resolvePreviousCommentCount(
      this.#session.currentProgramUrl,
      this.#session.currentProgramLatestCommentNo,
      incomingProgramUrl,
    );
    return Number.isFinite(resolved) && resolved > 0 ? resolved : 0;
  }

  onAir(state: StreamData | unknown): void {
    // biome-ignore lint/plugin/no-type-assertion: existing assertion
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
            // The previous live program ended without an observed offline
            // state (niconama switches between live URLs directly). Carry its
            // final comment count over so `previousStreamCommentCount` keeps
            // advancing instead of staying 0. When nothing at all is known
            // about the ended program, keep the count we already had rather
            // than resetting the gauge to 0.
            const endedCommentCount =
              this.#resolveEndedProgramCommentCount(url);
            if (endedCommentCount > 0) {
              this.#session.previousStreamCommentCount = endedCommentCount;
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
