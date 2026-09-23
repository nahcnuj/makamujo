import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadStreamBaseline,
  loadStreamBaselineWithRecovery,
  parseStreamBaseline,
  recoverPreviousStreamCommentCount,
  saveStreamBaseline,
} from "./streamBaselineStore";

const tempDirs: string[] = [];
const makeTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "stream-baseline-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseStreamBaseline", () => {
  it("defaults to a fresh session with no active program", () => {
    expect(parseStreamBaseline(undefined)).toEqual({
      previousStreamCommentCount: 0,
      currentProgramUrl: undefined,
      currentProgramLatestCommentNo: 0,
    });
    expect(parseStreamBaseline(null)).toEqual(parseStreamBaseline(undefined));
  });

  it("parses a valid baseline", () => {
    expect(
      parseStreamBaseline({
        previousStreamCommentCount: 538,
        currentProgramUrl: "https://live.example/watch/lv1",
        currentProgramLatestCommentNo: 540,
      }),
    ).toEqual({
      previousStreamCommentCount: 538,
      currentProgramUrl: "https://live.example/watch/lv1",
      currentProgramLatestCommentNo: 540,
    });
  });

  it("falls back per-field for corrupt values", () => {
    expect(
      parseStreamBaseline({
        previousStreamCommentCount: -1,
        currentProgramUrl: "",
        currentProgramLatestCommentNo: 1.5,
      }),
    ).toEqual({
      previousStreamCommentCount: 0,
      currentProgramUrl: undefined,
      currentProgramLatestCommentNo: 0,
    });
  });
});

describe("loadStreamBaseline", () => {
  it("returns defaults when the file is missing", () => {
    const dir = makeTempDir();
    expect(loadStreamBaseline(join(dir, "missing.json"))).toEqual(
      parseStreamBaseline(undefined),
    );
  });

  it("returns defaults when the file is corrupt", () => {
    const dir = makeTempDir();
    const path = join(dir, "corrupt.json");
    writeFileSync(path, "{not json");
    expect(loadStreamBaseline(path)).toEqual(parseStreamBaseline(undefined));
  });

  it("round-trips through saveStreamBaseline", () => {
    const dir = makeTempDir();
    const path = join(dir, "baseline.json");
    const baseline = {
      previousStreamCommentCount: 12,
      currentProgramUrl: "https://live.example/watch/lv2",
      currentProgramLatestCommentNo: 34,
    };

    saveStreamBaseline(path, baseline);
    expect(existsSync(path)).toBe(true);
    expect(loadStreamBaseline(path)).toEqual(baseline);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(baseline);
  });
});

describe("recoverPreviousStreamCommentCount", () => {
  const commentsDir = () => {
    const dir = join(makeTempDir(), "comments");
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  const programFileName = (programUrl: string) => {
    // Mirrors sanitizeProgramKey in CommentRecorder.
    return `${programUrl.replace(/[^a-zA-Z0-9._-]/g, "_")}.jsonl`;
  };

  const writeRecorded = (
    dir: string,
    fileName: string,
    commentNos: number[],
    mtimeMs: number,
  ) => {
    const lines = commentNos.map((no) =>
      JSON.stringify({ who: "viewer", comment: "hello", at: "x", no }),
    );
    const path = join(dir, fileName);
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
    utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
  };

  it("returns 0 when there is no comment record directory", () => {
    const dir = makeTempDir();
    expect(
      recoverPreviousStreamCommentCount(join(dir, "missing"), undefined),
    ).toBe(0);
  });

  it("returns 0 when only the current program has records", () => {
    const dir = commentsDir();
    const currentUrl = "https://live.example/watch/lv300";
    writeRecorded(dir, programFileName(currentUrl), [1, 5], 1_000);
    expect(recoverPreviousStreamCommentCount(dir, currentUrl)).toBe(0);
  });

  it("returns the previous program's final comment count", () => {
    const dir = commentsDir();
    const currentUrl = "https://live.example/watch/lv300";
    writeRecorded(dir, programFileName(currentUrl), [1, 5], 3_000);
    writeRecorded(
      dir,
      programFileName("https://live.example/watch/lv200"),
      [1, 538],
      2_000,
    );
    expect(recoverPreviousStreamCommentCount(dir, currentUrl)).toBe(538);
  });

  it("treats the most recently written non-current program as previous", () => {
    const dir = commentsDir();
    const currentUrl = "https://live.example/watch/lv300";
    writeRecorded(
      dir,
      programFileName("https://live.example/watch/lv100"),
      [1, 999],
      1_000,
    );
    writeRecorded(
      dir,
      programFileName("https://live.example/watch/lv200"),
      [1, 720],
      2_000,
    );
    writeRecorded(dir, programFileName(currentUrl), [1, 5], 3_000);
    expect(recoverPreviousStreamCommentCount(dir, currentUrl)).toBe(720);
  });

  it("skips unreadable record files", () => {
    const dir = commentsDir();
    writeFileSync(
      join(dir, programFileName("https://live.example/watch/lvBad")),
      "{corrupt\n",
      "utf8",
    );
    writeRecorded(
      dir,
      programFileName("https://live.example/watch/lv100"),
      [1, 42],
      1_000,
    );
    expect(recoverPreviousStreamCommentCount(dir, undefined)).toBe(42);
  });
});

describe("loadStreamBaselineWithRecovery", () => {
  it("keeps an already-persisted previous count", () => {
    const dir = makeTempDir();
    const comments = join(dir, "comments");
    mkdirSync(comments, { recursive: true });
    const path = join(dir, "baseline.json");
    saveStreamBaseline(path, {
      previousStreamCommentCount: 538,
      currentProgramUrl: "https://live.example/watch/lv300",
      currentProgramLatestCommentNo: 5,
    });
    const fileUrl = "https://live.example/watch/lv200";
    const fileName = `${fileUrl.replace(/[^a-zA-Z0-9._-]/g, "_")}.jsonl`;
    writeFileSync(
      join(comments, fileName),
      `${JSON.stringify({ no: 999 })}\n`,
      "utf8",
    );

    expect(
      loadStreamBaselineWithRecovery(path, comments).previousStreamCommentCount,
    ).toBe(538);
  });

  it("recovers the previous count when the baseline holds 0", () => {
    const dir = makeTempDir();
    const comments = join(dir, "comments");
    mkdirSync(comments, { recursive: true });
    const path = join(dir, "baseline.json");
    saveStreamBaseline(path, {
      previousStreamCommentCount: 0,
      currentProgramUrl: "https://live.example/watch/lv300",
      currentProgramLatestCommentNo: 5,
    });
    const fileUrl = "https://live.example/watch/lv200";
    const fileName = `${fileUrl.replace(/[^a-zA-Z0-9._-]/g, "_")}.jsonl`;
    writeFileSync(
      join(comments, fileName),
      `${JSON.stringify({ no: 720 })}\n`,
      "utf8",
    );

    expect(loadStreamBaselineWithRecovery(path, comments)).toEqual({
      previousStreamCommentCount: 720,
      currentProgramUrl: "https://live.example/watch/lv300",
      currentProgramLatestCommentNo: 5,
    });
  });
});
