import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
  recoverLastCommentAt,
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

  it("parses lastCommentAt from an ISO string", () => {
    // コメント受信時刻（ISO 8601 で永続化・復元される）
    const receivedAt = new Date(2023, 10, 14, 22, 13, 20, 0);
    expect(
      parseStreamBaseline({
        lastCommentAt: receivedAt.toISOString(),
      }),
    ).toEqual({
      previousStreamCommentCount: 0,
      currentProgramUrl: undefined,
      currentProgramLatestCommentNo: 0,
      lastCommentAt: new Date(receivedAt),
    });
  });

  it("ignores non-date lastCommentAt values", () => {
    expect(parseStreamBaseline({ lastCommentAt: "not-a-date" })).toEqual({
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

  it("round-trips lastCommentAt as a Date through saveStreamBaseline", () => {
    const dir = makeTempDir();
    const path = join(dir, "baseline.json");
    const receivedAt = new Date(2023, 10, 14, 22, 13, 20, 0);
    const baseline = {
      previousStreamCommentCount: 12,
      currentProgramUrl: "https://live.example/watch/lv2",
      currentProgramLatestCommentNo: 34,
      lastCommentAt: new Date(receivedAt),
    };

    saveStreamBaseline(path, baseline);
    expect(loadStreamBaseline(path)).toEqual(baseline);
  });

  it("replaces the previous content without leaving temp files", () => {
    const dir = makeTempDir();
    const path = join(dir, "baseline.json");
    saveStreamBaseline(path, {
      previousStreamCommentCount: 1,
      currentProgramLatestCommentNo: 2,
    });
    saveStreamBaseline(path, {
      previousStreamCommentCount: 538,
      currentProgramUrl: "https://live.example/watch/lv300",
      currentProgramLatestCommentNo: 5,
      retainedStatistics: { viewers: 42 },
    });

    expect(loadStreamBaseline(path)).toEqual({
      previousStreamCommentCount: 538,
      currentProgramUrl: "https://live.example/watch/lv300",
      currentProgramLatestCommentNo: 5,
      retainedStatistics: { viewers: 42 },
    });
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual(
      [],
    );
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

describe("recoverLastCommentAt", () => {
  const commentsDir = () => {
    const dir = join(makeTempDir(), "comments");
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  it("returns undefined when the directory is missing", () => {
    const dir = makeTempDir();
    expect(recoverLastCommentAt(join(dir, "missing"))).toBeUndefined();
  });

  it("returns undefined when no comment records exist", () => {
    const dir = commentsDir();
    expect(recoverLastCommentAt(dir)).toBeUndefined();
  });

  it("recovers the latest comment timestamp across files", () => {
    const dir = commentsDir();
    const older = new Date(2023, 10, 14, 22, 13, 20, 0);
    const newer = new Date(2023, 10, 14, 22, 14, 20, 0);
    writeFileSync(
      join(dir, "a.jsonl"),
      `${JSON.stringify({ no: 1, at: older.toISOString() })}\n`,
      "utf8",
    );
    writeFileSync(
      join(dir, "b.jsonl"),
      `${JSON.stringify({ no: 2, at: newer.toISOString() })}\n`,
      "utf8",
    );
    expect(recoverLastCommentAt(dir)?.getTime()).toBe(newer.getTime());
  });

  it("skips records with non-date at values", () => {
    const dir = commentsDir();
    const valid = 1_700_000_000_000;
    writeFileSync(
      join(dir, "mixed.jsonl"),
      `${JSON.stringify({ no: 1, at: "not-a-date" })}\n${JSON.stringify({ no: 2, at: valid })}\n`,
      "utf8",
    );
    expect(recoverLastCommentAt(dir)?.getTime()).toBe(valid);
  });

  it("also accepts numeric epoch ms at values", () => {
    const dir = commentsDir();
    const ms = 1_700_000_000_000;
    writeFileSync(
      join(dir, "numeric.jsonl"),
      `${JSON.stringify({ no: 1, at: ms })}\n`,
      "utf8",
    );
    expect(recoverLastCommentAt(dir)?.getTime()).toBe(ms);
  });
});

describe("loadStreamBaselineWithRecovery lastCommentAt", () => {
  it("takes the later of the persisted and recovered timestamps", () => {
    const dir = makeTempDir();
    const comments = join(dir, "comments");
    mkdirSync(comments, { recursive: true });
    const path = join(dir, "baseline.json");
    const persisted = new Date(2023, 10, 14, 22, 13, 20, 0);
    const recovered = new Date(2023, 10, 14, 22, 14, 20, 0);
    saveStreamBaseline(path, {
      previousStreamCommentCount: 5,
      currentProgramUrl: "https://live.example/watch/lv300",
      currentProgramLatestCommentNo: 5,
      lastCommentAt: new Date(persisted),
    });
    const fileUrl = "https://live.example/watch/lv200";
    const fileName = `${fileUrl.replace(/[^a-zA-Z0-9._-]/g, "_")}.jsonl`;
    writeFileSync(
      join(comments, fileName),
      `${JSON.stringify({ no: 1, at: recovered.toISOString() })}\n`,
      "utf8",
    );

    const result = loadStreamBaselineWithRecovery(path, comments);
    expect(result.lastCommentAt?.getTime()).toBe(recovered.getTime());
  });

  it("keeps the persisted timestamp when it is later", () => {
    const dir = makeTempDir();
    const comments = join(dir, "comments");
    mkdirSync(comments, { recursive: true });
    const path = join(dir, "baseline.json");
    const persisted = new Date(2023, 10, 14, 22, 14, 20, 0);
    const recovered = new Date(2023, 10, 14, 22, 13, 20, 0);
    saveStreamBaseline(path, {
      previousStreamCommentCount: 5,
      currentProgramUrl: "https://live.example/watch/lv300",
      currentProgramLatestCommentNo: 5,
      lastCommentAt: new Date(persisted),
    });
    const fileUrl = "https://live.example/watch/lv200";
    const fileName = `${fileUrl.replace(/[^a-zA-Z0-9._-]/g, "_")}.jsonl`;
    writeFileSync(
      join(comments, fileName),
      `${JSON.stringify({ no: 1, at: recovered.toISOString() })}\n`,
      "utf8",
    );

    const result = loadStreamBaselineWithRecovery(path, comments);
    expect(result.lastCommentAt?.getTime()).toBe(persisted.getTime());
  });
});
