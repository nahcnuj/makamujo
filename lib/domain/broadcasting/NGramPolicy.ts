/** N-gram size derivation from comment numbers (Broadcasting-owned metric). */

export const N_GRAM_LOG_SCALE = 2;
export const N_GRAM_LOG_BASELINE = 2;
export const INITIAL_COMMENT_NUMBER = 1;

/**
 * Raw (non-floored) n-gram size from a comment number.
 * Comment numbers below 1 are clamped to 1 (matches legacy `Math.max(1, commentNumber)`).
 */
export const inferNGramSizeRaw = (commentNumber: number): number => {
  const safeCommentNumber = Math.max(1, commentNumber);
  return (N_GRAM_LOG_SCALE * Math.log10(safeCommentNumber)) - N_GRAM_LOG_BASELINE;
};

/** Floored n-gram size, at least 1. */
export const inferNGramSize = (commentNumber: number): number => {
  return Math.max(1, Math.floor(inferNGramSizeRaw(commentNumber)));
};

export const initialNGramSize = (): number => inferNGramSize(INITIAL_COMMENT_NUMBER);
export const initialNGramSizeRaw = (): number => inferNGramSizeRaw(INITIAL_COMMENT_NUMBER);
