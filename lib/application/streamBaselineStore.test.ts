import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadStreamBaseline,
  parseStreamBaseline,
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
