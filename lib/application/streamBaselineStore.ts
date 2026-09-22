import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const STREAM_BASELINE_BASENAME = "stream-baseline.json";

/**
 * Comment-tracking state that must survive process restarts so the
 * delivery-voltage gauge keeps its baseline and current count.
 */
export type StreamBaseline = {
  /** Final comment count of the previous stream (voltage max baseline). */
  previousStreamCommentCount: number;
  /** Active program URL, so the same broadcast keeps counting after restart. */
  currentProgramUrl?: string;
  /** Last observed comment number of the active program. */
  currentProgramLatestCommentNo: number;
};

const toNonNegativeInteger = (value: unknown): number | undefined => {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value)) return undefined;
  return value >= 0 ? value : undefined;
};

/**
 * Coerce arbitrary (possibly corrupt) parsed JSON into a StreamBaseline.
 * Invalid fields fall back to the fresh-session defaults so a bad file never
 * crashes startup.
 */
export const parseStreamBaseline = (raw: unknown): StreamBaseline => {
  const record =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : undefined;
  return {
    previousStreamCommentCount:
      toNonNegativeInteger(record?.previousStreamCommentCount) ?? 0,
    currentProgramUrl:
      typeof record?.currentProgramUrl === "string" &&
      record.currentProgramUrl.length > 0
        ? record.currentProgramUrl
        : undefined,
    currentProgramLatestCommentNo:
      toNonNegativeInteger(record?.currentProgramLatestCommentNo) ?? 0,
  };
};

export const loadStreamBaseline = (filePath: string): StreamBaseline => {
  if (!existsSync(filePath)) {
    return parseStreamBaseline(undefined);
  }
  try {
    return parseStreamBaseline(JSON.parse(readFileSync(filePath, "utf8")));
  } catch (err) {
    console.warn(
      "[WARN] failed to read stream baseline, starting fresh:",
      err instanceof Error ? err.message : String(err),
    );
    return parseStreamBaseline(undefined);
  }
};

export const saveStreamBaseline = (
  filePath: string,
  baseline: StreamBaseline,
): void => {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  } catch (err) {
    console.warn(
      "[WARN] failed to persist stream baseline:",
      err instanceof Error ? err.message : String(err),
    );
  }
};
