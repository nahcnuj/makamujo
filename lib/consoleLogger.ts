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

  let activeDate = currentDate;

  return {
    write(record: JsonLogRecord): void {
      const currentTime = now();
      const logDate = formatLogDate(currentTime);
      if (logDate !== activeDate) {
        rotateLogFile(logFilePath, activeDate);
        activeDate = logDate;
      }

      appendFileSync(logFilePath, `${JSON.stringify({ timestamp: currentTime.toISOString(), ...record })}\n`);
    },
  };
}

function ensureLogDirectory(logFilePath: string): void {
  mkdirSync(dirname(logFilePath), { recursive: true });
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
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
