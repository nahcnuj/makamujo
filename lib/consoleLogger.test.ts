import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDailyRotatingJsonLogger } from "./consoleLogger";

function createTempLogPath() {
  const tempDirectoryPath = mkdtempSync(join(tmpdir(), "console-logger-test-"));
  return {
    tempDirectoryPath,
    logFilePath: join(tempDirectoryPath, "access.log"),
  };
}

test("writes structured JSON logs", () => {
  const { tempDirectoryPath, logFilePath } = createTempLogPath();
  try {
    const logger = createDailyRotatingJsonLogger(logFilePath, {
      now: () => new Date("2026-04-18T12:00:00.000Z"),
    });

    logger.write({ event: "console_access", status: 200 });

    const logLine = readFileSync(logFilePath, "utf8").trim();
    const entry = JSON.parse(logLine) as Record<string, unknown>;

    expect(entry.timestamp).toBe("2026-04-18T12:00:00.000Z");
    expect(entry.event).toBe("console_access");
    expect(entry.status).toBe(200);
  } finally {
    rmSync(tempDirectoryPath, { recursive: true, force: true });
  }
});

test("overrides caller-provided timestamp with write-time timestamp", () => {
  const { tempDirectoryPath, logFilePath } = createTempLogPath();
  try {
    const logger = createDailyRotatingJsonLogger(logFilePath, {
      now: () => new Date("2026-04-18T12:00:00.000Z"),
    });

    logger.write({ event: "console_access", timestamp: "caller-provided" });

    const logLine = readFileSync(logFilePath, "utf8").trim();
    const entry = JSON.parse(logLine) as Record<string, unknown>;
    expect(entry.timestamp).toBe("2026-04-18T12:00:00.000Z");
  } finally {
    rmSync(tempDirectoryPath, { recursive: true, force: true });
  }
});

test("rotates to dated file when date changes", () => {
  const { tempDirectoryPath, logFilePath } = createTempLogPath();
  const firstDate = new Date("2026-04-18T12:00:00.000Z");
  const secondDate = new Date("2026-04-19T12:00:00.000Z");
  let currentDate = firstDate;

  try {
    const logger = createDailyRotatingJsonLogger(logFilePath, {
      now: () => currentDate,
    });

    logger.write({ event: "first" });
    currentDate = secondDate;
    logger.write({ event: "second" });

    const rotatedLogPath = `${logFilePath}.2026-04-18`;
    expect(existsSync(rotatedLogPath)).toBe(true);
    expect(readFileSync(rotatedLogPath, "utf8")).toContain('"event":"first"');
    expect(readFileSync(logFilePath, "utf8")).toContain('"event":"second"');
  } finally {
    rmSync(tempDirectoryPath, { recursive: true, force: true });
  }
});

test("rotates to next suffixed path when rotated file already exists", () => {
  const { tempDirectoryPath, logFilePath } = createTempLogPath();
  const firstDate = new Date("2026-04-18T12:00:00.000Z");
  const secondDate = new Date("2026-04-19T12:00:00.000Z");
  let currentDate = firstDate;

  try {
    writeFileSync(`${logFilePath}.2026-04-18`, '{"event":"existing"}\n');
    writeFileSync(`${logFilePath}.2026-04-18.1`, '{"event":"existing1"}\n');
    const logger = createDailyRotatingJsonLogger(logFilePath, {
      now: () => currentDate,
    });

    logger.write({ event: "first" });
    currentDate = secondDate;
    logger.write({ event: "second" });

    const rotatedLogPath = `${logFilePath}.2026-04-18.2`;
    expect(existsSync(rotatedLogPath)).toBe(true);
    expect(readFileSync(rotatedLogPath, "utf8")).toContain('"event":"first"');
  } finally {
    rmSync(tempDirectoryPath, { recursive: true, force: true });
  }
});

test("rotates stale startup log based on file mtime", () => {
  const { tempDirectoryPath, logFilePath } = createTempLogPath();

  try {
    writeFileSync(logFilePath, '{"event":"stale"}\n');
    utimesSync(logFilePath, new Date("2026-04-17T12:00:00.000Z"), new Date("2026-04-17T12:00:00.000Z"));

    const logger = createDailyRotatingJsonLogger(logFilePath, {
      now: () => new Date("2026-04-18T12:00:00.000Z"),
    });

    const rotatedLogPath = `${logFilePath}.2026-04-17`;
    expect(existsSync(rotatedLogPath)).toBe(true);
    expect(readFileSync(rotatedLogPath, "utf8")).toContain('"event":"stale"');

    logger.write({ event: "fresh" });
    expect(readFileSync(logFilePath, "utf8")).toContain('"event":"fresh"');
  } finally {
    rmSync(tempDirectoryPath, { recursive: true, force: true });
  }
});
