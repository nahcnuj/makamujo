/** Silence / speechable evaluation — ordered algorithm matching MakaMujo.speechable. */

export const SPEECHABLE_BROWSER_STATES = ["idle", "result", "closed"] as const;

export type SilenceClockInput = {
  /** When stream is offline / not live, pass undefined to skip silence gates. */
  streamLive: boolean;
  lastCommentAt: Date | undefined;
  listenersStaleSince: Date | undefined;
  hasPromptedCommentForViewerIncrease: boolean;
  browserStateName: string | undefined;
  nowMs: number;
  thresholdMs: number;
};

/**
 * Silence is driven by comments only while live.
 * Listener activity is intentionally ignored here (sprite visibility is a frontend concern).
 * Viewer-increase comment prompt still goes through StreamApplicationService.speech() directly.
 *
 * 1. If live and commentsStale → false
 * 2. Else browserOk (missing browser state defaults to 'idle')
 */
export const evaluateSpeechable = (input: SilenceClockInput): boolean => {
  if (input.streamLive) {
    const commentsStale =
      input.lastCommentAt === undefined ||
      input.nowMs - input.lastCommentAt.getTime() >= input.thresholdMs;

    if (commentsStale) {
      return false;
    }
  }

  const browserName = input.browserStateName ?? "idle";
  return (SPEECHABLE_BROWSER_STATES as readonly string[]).includes(browserName);
};

export type CommentPromptInput = {
  hadCommentBefore: boolean;
  commentsStale: boolean;
  hasPromptedCommentForViewerIncrease: boolean;
};

/** Pure decision for viewer-increase comment prompt (side effects stay in onAir). */
export const shouldPromptCommentAfterViewerIncrease = (
  input: CommentPromptInput,
): boolean => {
  return (
    input.hadCommentBefore &&
    input.commentsStale &&
    !input.hasPromptedCommentForViewerIncrease
  );
};

export const isCommentsStale = (
  lastCommentAt: Date | undefined,
  nowMs: number,
  thresholdMs: number,
): boolean => {
  return (
    lastCommentAt === undefined ||
    nowMs - lastCommentAt.getTime() >= thresholdMs
  );
};

/**
 * Alias matching the documented `SilencePolicy.evaluate` signature.
 * Delegates to `evaluateSpeechable` so there is a single source of truth.
 */
export type SilencePolicyEvaluateInput = {
  now: number;
  streamStateDefined: boolean;
  listenersStaleSince: Date | undefined;
  lastCommentAt: Date | undefined;
  hasPrompted: boolean;
  browserStateName: string | undefined;
  thresholdMs: number;
};

export const evaluate = (input: SilencePolicyEvaluateInput): boolean =>
  evaluateSpeechable({
    streamLive: input.streamStateDefined,
    lastCommentAt: input.lastCommentAt,
    listenersStaleSince: input.listenersStaleSince,
    hasPromptedCommentForViewerIncrease: input.hasPrompted,
    browserStateName: input.browserStateName,
    nowMs: input.now,
    thresholdMs: input.thresholdMs,
  });
