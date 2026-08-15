/**
 * Pure SSE frame buffer helpers (console → broadcasting proxy).
 * Incomplete frames stay in the buffer; only complete events are emitted.
 */

export type SseBoundary = { end: number; length: number };

/**
 * Position and delimiter length of the first complete SSE frame boundary
 * (`\n\n` or `\r\n\r\n`), or null if none.
 */
export const findSseBoundary = (buffer: string): SseBoundary | null => {
  const lfIdx = buffer.indexOf("\n\n");
  const crlfIdx = buffer.indexOf("\r\n\r\n");
  if (lfIdx === -1 && crlfIdx === -1) return null;
  if (lfIdx !== -1 && (crlfIdx === -1 || lfIdx <= crlfIdx))
    return { end: lfIdx, length: 2 };
  return { end: crlfIdx, length: 4 };
};

export type SseFrameExtractResult = {
  /** Complete frames including their trailing boundary bytes. */
  frames: string[];
  /** Remainder without a complete boundary (may be incomplete event). */
  rest: string;
};

/**
 * Split a buffer into zero or more complete SSE frames and leftover incomplete text.
 * Incomplete frames are not included in `frames` (discarded on upstream drop by the proxy).
 */
export const extractCompleteSseFrames = (
  buffer: string,
): SseFrameExtractResult => {
  const frames: string[] = [];
  let rest = buffer;
  let boundary = findSseBoundary(rest);
  while (boundary !== null) {
    const { end, length } = boundary;
    frames.push(rest.slice(0, end + length));
    rest = rest.slice(end + length);
    boundary = findSseBoundary(rest);
  }
  return { frames, rest };
};

/**
 * Extract `data:` payload lines from a single SSE event block (without requiring trailing boundary).
 * Returns null when the event has no data lines.
 */
export const extractSseDataPayload = (eventBlock: string): string | null => {
  const dataLines = eventBlock
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"));
  if (dataLines.length === 0) return null;
  return dataLines.map((l) => l.replace(/^data:\s?/, "")).join("\n");
};

/**
 * Consume buffered SSE text for `forwardSSEEventsToSink`-style sinks:
 * emit data payloads for complete events; keep incomplete tail in buffer.
 */
export const drainSseDataPayloads = (
  buffer: string,
): { payloads: string[]; rest: string } => {
  const payloads: string[] = [];
  let rest = buffer;
  // Use same boundary scan as legacy forwardSSEEventsToSink
  let idx = rest.indexOf("\r\n\r\n");
  if (idx === -1) idx = rest.indexOf("\n\n");
  while (idx !== -1) {
    const event = rest.slice(0, idx);
    const delimLen = rest.startsWith("\r\n", idx) ? 4 : 2;
    rest = rest.slice(idx + delimLen);
    const data = extractSseDataPayload(event);
    if (data !== null) payloads.push(data);
    idx = rest.indexOf("\r\n\r\n");
    if (idx === -1) idx = rest.indexOf("\n\n");
  }
  return { payloads, rest };
};
