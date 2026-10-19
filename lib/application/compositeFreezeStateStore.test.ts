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
import { createCompositeFreezeState } from "../domain/broadcasting/CompositeFreezePolicy";
import {
  COMPOSITE_FREEZE_STATE_BASENAME,
  loadCompositeFreezeState,
  parseCompositeFreezeState,
  saveCompositeFreezeState,
} from "./compositeFreezeStateStore";

const tempDirs: string[] = [];
const makeTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "composite-freeze-state-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseCompositeFreezeState", () => {
  it("defaults to a fresh session when nothing has been recorded", () => {
    expect(parseCompositeFreezeState(undefined)).toEqual(
      createCompositeFreezeState(),
    );
    expect(parseCompositeFreezeState("not an object")).toEqual(
      createCompositeFreezeState(),
    );
  });

  it("keeps a recorded rung and cooldown anchor", () => {
    expect(
      parseCompositeFreezeState({
        stillCycles: 2,
        recoveryIndex: 1,
        lastRecoveryAtMs: 1_800_000,
      }),
    ).toEqual({
      stillCycles: 2,
      recoveryIndex: 1,
      lastRecoveryAtMs: 1_800_000,
    });
  });

  it("drops invalid fields instead of crashing startup", () => {
    expect(
      parseCompositeFreezeState({
        stillCycles: -1,
        recoveryIndex: "1",
        lastRecoveryAtMs: Number.NaN,
      }),
    ).toEqual(createCompositeFreezeState());
  });

  it("clamps a rung index beyond the ladder to the deepest rung", () => {
    expect(parseCompositeFreezeState({ recoveryIndex: 9 }).recoveryIndex).toBe(
      2,
    );
  });
});

describe("loadCompositeFreezeState", () => {
  it("starts fresh when the file does not exist yet", () => {
    const filePath = join(
      makeTempDir(),
      "var",
      COMPOSITE_FREEZE_STATE_BASENAME,
    );
    expect(loadCompositeFreezeState(filePath)).toEqual(
      createCompositeFreezeState(),
    );
  });

  it("round-trips a state that survived a restart", () => {
    const filePath = join(makeTempDir(), COMPOSITE_FREEZE_STATE_BASENAME);
    const state = {
      stillCycles: 1,
      recoveryIndex: 1,
      lastRecoveryAtMs: 60_000,
    };
    saveCompositeFreezeState(filePath, state);
    expect(loadCompositeFreezeState(filePath)).toEqual(state);
  });

  it("starts fresh when the file is corrupt", () => {
    const filePath = join(makeTempDir(), COMPOSITE_FREEZE_STATE_BASENAME);
    writeFileSync(filePath, "{ truncated", "utf8");
    expect(loadCompositeFreezeState(filePath)).toEqual(
      createCompositeFreezeState(),
    );
  });
});

describe("saveCompositeFreezeState", () => {
  it("writes a readable file and leaves no temporary file behind", () => {
    const filePath = join(
      makeTempDir(),
      "var",
      COMPOSITE_FREEZE_STATE_BASENAME,
    );
    saveCompositeFreezeState(filePath, {
      stillCycles: 0,
      recoveryIndex: 2,
      lastRecoveryAtMs: 12_000,
    });

    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({
      stillCycles: 0,
      recoveryIndex: 2,
      lastRecoveryAtMs: 12_000,
    });
    const leftovers = readFileSync(filePath, "utf8");
    expect(leftovers.endsWith("\n")).toBe(true);
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it("replaces an existing file instead of appending to it", () => {
    const filePath = join(makeTempDir(), COMPOSITE_FREEZE_STATE_BASENAME);
    saveCompositeFreezeState(filePath, {
      stillCycles: 3,
      recoveryIndex: 0,
      lastRecoveryAtMs: undefined,
    });
    saveCompositeFreezeState(filePath, {
      stillCycles: 0,
      recoveryIndex: 1,
      lastRecoveryAtMs: 180_000,
    });

    expect(loadCompositeFreezeState(filePath)).toEqual({
      stillCycles: 0,
      recoveryIndex: 1,
      lastRecoveryAtMs: 180_000,
    });
  });
});
