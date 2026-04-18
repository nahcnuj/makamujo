import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

type LoggerOptions = {
  now?: () => Date;
};

export type JsonLogRecord = Record<string, unknown>;

export function createDailyRotatingJsonLogger(logFilePath: string, options: LoggerOptions = {}) {
  const now = options.now ?? (() => new Date());
  const currentDate = formatLogDate(now());

  ensureLogDirectory(logFilePath);
  rotateExistingFileOnStartup(logFilePath, currentDate);
  ensureLogWritable(logFilePath);

  let activeDate = currentDate;

  return {
    write(record: JsonLogRecord): void {
      try {
        const currentTime = now();
        const logDate = formatLogDate(currentTime);
        if (logDate !== activeDate) {
          rotateLogFile(logFilePath, activeDate);
          activeDate = logDate;
        }

        const { timestamp: _ignoredTimestamp, ...recordWithoutTimestamp } = record;
        appendFileSync(logFilePath, `${JSON.stringify({ timestamp: formatJstTimestamp(currentTime), ...recordWithoutTimestamp })}\n`);
      } catch (error) {
        writeStderr(`Failed to write log entry to ${logFilePath}: ${formatUnknownError(error)}\n`);
      }
    },
  };
}

function writeStderr(message: string): void {
  try {
    process.stderr.write(message);
  } catch {
    // Best-effort logger: ignore stderr failures.
  }
}

function ensureLogDirectory(logFilePath: string): void {
  mkdirSync(dirname(logFilePath), { recursive: true });
}

/**
 * Ensure the log file is writable during startup.
 * Throws when append open/create is not permitted.
 */
function ensureLogWritable(logFilePath: string): void {
  appendFileSync(logFilePath, "");
}

function rotateExistingFileOnStartup(logFilePath: string, currentDate: string): void {
  if (!existsSync(logFilePath)) {
    return;
  }

  const fileDate = formatLogDate(statSync(logFilePath).mtime);
  if (fileDate === currentDate) {
    return;
  }

  rotateLogFile(logFilePath, fileDate);
}

function rotateLogFile(logFilePath: string, rotationDate: string): void {
  if (!existsSync(logFilePath)) {
    return;
  }

  const baseRotatedPath = `${logFilePath}.${rotationDate}`;
  if (!existsSync(baseRotatedPath)) {
    renameSync(logFilePath, baseRotatedPath);
    return;
  }

  let sequence = 1;
  let candidatePath = `${baseRotatedPath}.${sequence}`;
  while (existsSync(candidatePath)) {
    sequence += 1;
    candidatePath = `${baseRotatedPath}.${sequence}`;
  }

  renameSync(logFilePath, candidatePath);
}

function formatLogDate(date: Date): string {
  const jstDate = toJstDate(date);
  const year = String(jstDate.getUTCFullYear());
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jstDate.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatJstTimestamp(date: Date): string {
  const jstDate = toJstDate(date);
  const year = String(jstDate.getUTCFullYear());
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jstDate.getUTCDate()).padStart(2, "0");
  const hours = String(jstDate.getUTCHours()).padStart(2, "0");
  const minutes = String(jstDate.getUTCMinutes()).padStart(2, "0");
  const seconds = String(jstDate.getUTCSeconds()).padStart(2, "0");
  const milliseconds = String(jstDate.getUTCMilliseconds()).padStart(3, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}+09:00`;
}

function toJstDate(date: Date): Date {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}
