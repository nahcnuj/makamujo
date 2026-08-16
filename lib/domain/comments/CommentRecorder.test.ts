import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  recordComment,
  resolveCommentWho,
  sanitizeProgramKey,
  type RecordedComment,
} from "./CommentRecorder";

const testBaseDir = join("var", "comments-test-tmp");

afterEach(() => {
  if (existsSync(testBaseDir)) {
    rmSync(testBaseDir, { recursive: true, force: true });
  }
});

describe("sanitizeProgramKey", () => {
  test("keeps safe characters", () => {
    expect(sanitizeProgramKey("abc-123_XYZ.live")).toBe("abc-123_XYZ.live");
  });

  test("replaces unsafe characters with underscore", () => {
    expect(
      sanitizeProgramKey("https://live.nicovideo.jp/watch/lv123?x=1"),
    ).toBe("https___live.nicovideo.jp_watch_lv123_x_1");
  });
});

describe("resolveCommentWho", () => {
  test("groups anonymity into anonymous", () => {
    expect(
      resolveCommentWho({ anonymity: true, name: "foo", userId: "uid" }),
    ).toBe("anonymous");
  });

  test("prefers name over userId", () => {
    expect(
      resolveCommentWho({
        anonymity: false,
        name: "表示名",
        userId: "uid123",
      }),
    ).toBe("表示名");
  });

  test("falls back to userId", () => {
    expect(resolveCommentWho({ anonymity: false, userId: "uid" })).toBe("uid");
  });

  test("falls back to unknown", () => {
    expect(resolveCommentWho({ anonymity: false })).toBe("unknown");
  });

  test("trims name", () => {
    expect(
      resolveCommentWho({ anonymity: false, name: "  hello  " }),
    ).toBe("hello");
  });
});

describe("recordComment", () => {
  test("does nothing when programKey is missing", async () => {
    await recordComment(
      null,
      { comment: "hello", anonymity: false },
      { baseDir: testBaseDir },
    );
    await recordComment(
      undefined,
      { comment: "hello", anonymity: false },
      { baseDir: testBaseDir },
    );
    expect(existsSync(testBaseDir)).toBe(false);
  });

  test("skips system comments", async () => {
    await recordComment(
      "https://example.com/lv1",
      {
        comment: "system msg",
        anonymity: false,
        userId: "onecomme.system",
        name: "生放送クルーズ",
      },
      { baseDir: testBaseDir },
    );
    expect(existsSync(testBaseDir)).toBe(false);
  });

  test("skips empty or whitespace-only comments", async () => {
    await recordComment(
      "prog-empty",
      { comment: "   ", anonymity: false, name: "a" },
      { baseDir: testBaseDir },
    );
    expect(existsSync(testBaseDir)).toBe(false);
  });

  test("appends JSONL with anonymous who and metadata", async () => {
    const programKey = "https://live.example/watch/lv999";
    await recordComment(
      programKey,
      {
        comment: "  匿名コメント  ",
        anonymity: true,
        name: "ignored",
        userId: "secret",
        no: 42,
        hasGift: true,
        isOwner: false,
      },
      { baseDir: testBaseDir },
    );

    const filePath = join(
      testBaseDir,
      `${sanitizeProgramKey(programKey)}.jsonl`,
    );
    expect(existsSync(filePath)).toBe(true);

    const entry = JSON.parse(
      readFileSync(filePath, "utf8").trim(),
    ) as RecordedComment;
    expect(entry.who).toBe("anonymous");
    expect(entry.comment).toBe("匿名コメント");
    expect(entry.no).toBe(42);
    expect(entry.hasGift).toBe(true);
    expect(entry.isOwner).toBe(false);
    expect(typeof entry.at).toBe("string");
    expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
  });

  test("appends multiple lines for the same program", async () => {
    const programKey = "prog-multi";
    mkdirSync(testBaseDir, { recursive: true });

    await recordComment(
      programKey,
      { comment: "one", anonymity: false, name: "Alice" },
      { baseDir: testBaseDir },
    );
    await recordComment(
      programKey,
      { comment: "two", anonymity: true },
      { baseDir: testBaseDir },
    );

    const filePath = join(
      testBaseDir,
      `${sanitizeProgramKey(programKey)}.jsonl`,
    );
    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!) as RecordedComment;
    const second = JSON.parse(lines[1]!) as RecordedComment;
    expect(first.who).toBe("Alice");
    expect(first.comment).toBe("one");
    expect(second.who).toBe("anonymous");
    expect(second.comment).toBe("two");
  });

  test("NFC-normalizes comment text", async () => {
    const nfdLike = "か\u3099";
    await recordComment(
      "prog-nfc",
      { comment: nfdLike, anonymity: false, userId: "u1" },
      { baseDir: testBaseDir },
    );
    const filePath = join(
      testBaseDir,
      `${sanitizeProgramKey("prog-nfc")}.jsonl`,
    );
    const entry = JSON.parse(
      readFileSync(filePath, "utf8").trim(),
    ) as RecordedComment;
    expect(entry.comment).toBe("が");
    expect(entry.who).toBe("u1");
  });
});