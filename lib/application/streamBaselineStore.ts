import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { sanitizeProgramKey } from "../domain/comments/CommentRecorder";

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

const recordedProgramFileName = (programUrl: string): string =>
  `${sanitizeProgramKey(programUrl)}.jsonl`;

type RecordedProgramCount = {
  fileName: string;
  maxCommentNo: number;
  mtimeMs: number;
};

const readRecordedProgramCounts = (
  commentsDir: string,
): RecordedProgramCount[] => {
  let entries: Dirent[];
  try {
    entries = readdirSync(commentsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const programs: RecordedProgramCount[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const path = join(commentsDir, entry.name);
    let maxCommentNo = 0;
    let mtimeMs: number | undefined;
    try {
      mtimeMs = statSync(path).mtimeMs;
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const no = (JSON.parse(trimmed) as { no?: unknown }).no;
        if (
          typeof no === "number" &&
          Number.isInteger(no) &&
          no > maxCommentNo
        ) {
          maxCommentNo = no;
        }
      }
    } catch {
      continue;
    }
    if (mtimeMs !== undefined && maxCommentNo > 0) {
      programs.push({ fileName: entry.name, maxCommentNo, mtimeMs });
    }
  }
  return programs;
};

/**
 * Recover the previous stream's final comment count from the recorded comment
 * files (`var/comments/<program>.jsonl`) when the baseline lost it (e.g. the
 * currently running program started before the carry-over fix was deployed).
 * The most recently written program other than the current one is treated as
 * the previous stream; its largest comment `no` is the final count.
 */
export const recoverPreviousStreamCommentCount = (
  commentsDir: string,
  currentProgramUrl: string | undefined,
): number => {
  const currentFileName = currentProgramUrl
    ? recordedProgramFileName(currentProgramUrl)
    : undefined;
  let previous: RecordedProgramCount | undefined;
  for (const program of readRecordedProgramCounts(commentsDir)) {
    if (program.fileName === currentFileName) continue;
    if (previous === undefined || program.mtimeMs > previous.mtimeMs) {
      previous = program;
    }
  }
  return previous?.maxCommentNo ?? 0;
};

/**
 * Load the baseline, then fill in a missing `previousStreamCommentCount` from
 * recorded comments. An already-persisted non-zero count is never overwritten.
 */
export const loadStreamBaselineWithRecovery = (
  baselinePath: string,
  commentsDir: string,
): StreamBaseline => {
  const baseline = loadStreamBaseline(baselinePath);
  if (baseline.previousStreamCommentCount > 0) return baseline;
  const recovered = recoverPreviousStreamCommentCount(
    commentsDir,
    baseline.currentProgramUrl,
  );
  if (recovered > 0) {
    return { ...baseline, previousStreamCommentCount: recovered };
  }
  return baseline;
};
