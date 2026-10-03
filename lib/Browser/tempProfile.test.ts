import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createSweptTemporaryProfileDir,
  createTemporaryProfileDir,
  isProcessAlive,
  listLiveTemporaryProfileDirs,
  MAKAMUJO_TEMP_PREFIXES,
  releaseTemporaryProfileDir,
  sweepStaleTemporaryProfileDirs,
} from "./tempProfile";

/** A pid that is syntactically valid but cannot be running in practice. */
const DEAD_PID = 2 ** 31 - 1;

const roots: string[] = [];

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "temp-profile-test-"));
  roots.push(root);
  return root;
};

const stampOwner = (dir: string, pid: number): void => {
  writeFileSync(
    join(dir, "makamujo-owner.json"),
    JSON.stringify({ pid, createdAtMs: Date.now() }),
  );
};

const readOwnerPid = (dir: string): unknown => {
  const parsed: unknown = JSON.parse(
    readFileSync(join(dir, "makamujo-owner.json"), "utf8"),
  );
  if (typeof parsed !== "object" || parsed === null || !("pid" in parsed)) {
    return undefined;
  }
  return parsed.pid;
};

/** Backdate a directory's mtime by `ms` so the grace period can be tested. */
const backdate = (dir: string, ms: number): void => {
  const when = (Date.now() - ms) / 1000;
  utimesSync(dir, when, when);
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("isProcessAlive", () => {
  it("reports this process as alive", () => {
    expect(isProcessAlive(process.pid)).toBeTrue();
  });

  it("rejects non-integer and non-positive pids", () => {
    expect(isProcessAlive(0)).toBeFalse();
    expect(isProcessAlive(-1)).toBeFalse();
    expect(isProcessAlive(1.5)).toBeFalse();
  });

  it("reports an implausible pid as dead", () => {
    expect(isProcessAlive(DEAD_PID)).toBeFalse();
  });
});

describe("createTemporaryProfileDir", () => {
  it("creates the dir under the given root and stamps the owner pid", () => {
    const root = makeRoot();
    const dir = createTemporaryProfileDir("makamujo-game-", root);
    try {
      expect(existsSync(dir)).toBeTrue();
      expect(dir.startsWith(join(root, "makamujo-game-"))).toBeTrue();
      expect(listLiveTemporaryProfileDirs()).toContain(dir);
      expect(readOwnerPid(dir)).toBe(process.pid);
    } finally {
      releaseTemporaryProfileDir(dir);
    }
  });

  it("releaseTemporaryProfileDir removes the dir and unregisters it", () => {
    const root = makeRoot();
    const dir = createTemporaryProfileDir("makamujo-game-", root);
    releaseTemporaryProfileDir(dir);
    expect(existsSync(dir)).toBeFalse();
    expect(listLiveTemporaryProfileDirs()).not.toContain(dir);
  });

  it("releaseTemporaryProfileDir never throws for a missing dir", () => {
    expect(() =>
      releaseTemporaryProfileDir(join(makeRoot(), "never-existed")),
    ).not.toThrow();
  });
});

describe("sweepStaleTemporaryProfileDirs", () => {
  it("removes a directory whose owning process is gone", () => {
    const root = makeRoot();
    const dir = mkdtempSync(join(root, "makamujo-game-"));
    stampOwner(dir, DEAD_PID);

    const removed = sweepStaleTemporaryProfileDirs(root);

    expect(removed).toEqual([dir]);
    expect(existsSync(dir)).toBeFalse();
  });

  it("keeps a directory whose owning process is still running", () => {
    const root = makeRoot();
    const dir = mkdtempSync(join(root, "makamujo-game-"));
    stampOwner(dir, process.pid);

    expect(sweepStaleTemporaryProfileDirs(root)).toEqual([]);
    expect(existsSync(dir)).toBeTrue();
  });

  it("covers every project prefix", () => {
    const root = makeRoot();
    const dirs = MAKAMUJO_TEMP_PREFIXES.map((prefix) => {
      const dir = mkdtempSync(join(root, prefix));
      stampOwner(dir, DEAD_PID);
      return dir;
    });

    expect(sweepStaleTemporaryProfileDirs(root).sort()).toEqual(dirs.sort());
    for (const dir of dirs) expect(existsSync(dir)).toBeFalse();
  });

  it("ignores directories owned by other projects", () => {
    const root = makeRoot();
    const other = mkdtempSync(join(root, "someone-else-"));
    const playwright = mkdtempSync(join(root, "playwright-"));

    expect(sweepStaleTemporaryProfileDirs(root)).toEqual([]);
    expect(existsSync(other)).toBeTrue();
    expect(existsSync(playwright)).toBeTrue();
  });

  it("removes an unmarked directory only once past the grace period", () => {
    const root = makeRoot();
    const old = mkdtempSync(join(root, "makamujo-game-"));
    const fresh = mkdtempSync(join(root, "makamujo-game-"));
    backdate(old, 2 * 60 * 60 * 1000);

    expect(sweepStaleTemporaryProfileDirs(root)).toEqual([old]);
    expect(existsSync(old)).toBeFalse();
    expect(existsSync(fresh)).toBeTrue();
  });

  it("keeps an unmarked directory whose marker could not be written yet", () => {
    const root = makeRoot();
    const dir = mkdtempSync(join(root, "makamujo-game-"));
    writeFileSync(join(dir, "makamujo-owner.json"), "not json");

    expect(sweepStaleTemporaryProfileDirs(root)).toEqual([]);
    expect(existsSync(dir)).toBeTrue();
  });

  it("never sweeps a directory this process is still using", () => {
    const root = makeRoot();
    const mine = createTemporaryProfileDir("makamujo-game-", root);
    try {
      // Even with a dead owner marker and a far-future clock, our own
      // directory must survive.
      rmSync(join(mine, "makamujo-owner.json"), { force: true });
      expect(
        sweepStaleTemporaryProfileDirs(root, Date.now() + 86_400_000),
      ).toEqual([]);
      expect(existsSync(mine)).toBeTrue();
    } finally {
      releaseTemporaryProfileDir(mine);
    }
  });

  it("returns an empty list when the root does not exist", () => {
    expect(
      sweepStaleTemporaryProfileDirs(join(makeRoot(), "missing-root")),
    ).toEqual([]);
  });

  it("honours MAKAMUJO_TEMP_PROFILE_GRACE_MS for unmarked directories", () => {
    const root = makeRoot();
    const dir = mkdtempSync(join(root, "makamujo-game-"));
    backdate(dir, 30_000);
    const previous = process.env.MAKAMUJO_TEMP_PROFILE_GRACE_MS;
    process.env.MAKAMUJO_TEMP_PROFILE_GRACE_MS = "1000";
    try {
      expect(sweepStaleTemporaryProfileDirs(root)).toEqual([dir]);
      expect(existsSync(dir)).toBeFalse();
    } finally {
      if (previous === undefined) {
        delete process.env.MAKAMUJO_TEMP_PROFILE_GRACE_MS;
      } else {
        process.env.MAKAMUJO_TEMP_PROFILE_GRACE_MS = previous;
      }
    }
  });

  it("falls back to the default grace period for an invalid override", () => {
    const root = makeRoot();
    const dir = mkdtempSync(join(root, "makamujo-game-"));
    backdate(dir, 30_000);
    const previous = process.env.MAKAMUJO_TEMP_PROFILE_GRACE_MS;
    process.env.MAKAMUJO_TEMP_PROFILE_GRACE_MS = "not-a-number";
    try {
      // The default grace is one hour, so a 30s-old directory survives.
      expect(sweepStaleTemporaryProfileDirs(root)).toEqual([]);
      expect(existsSync(dir)).toBeTrue();
    } finally {
      if (previous === undefined) {
        delete process.env.MAKAMUJO_TEMP_PROFILE_GRACE_MS;
      } else {
        process.env.MAKAMUJO_TEMP_PROFILE_GRACE_MS = previous;
      }
    }
  });
});

describe("temp profile cleanup on process exit", () => {
  it("removes the directory when the owning process exits", async () => {
    const root = makeRoot();
    const moduleUrl = pathToFileURL(
      join(import.meta.dir, "tempProfile.ts"),
    ).href;
    const proc = Bun.spawn(
      [
        process.execPath,
        "-e",
        `const m = await import(${JSON.stringify(moduleUrl)});` +
          `process.stdout.write(m.createTemporaryProfileDir("makamujo-game-"));`,
      ],
      {
        // Point every platform-specific temp variable at the sandbox root so
        // `tmpdir()` in the child resolves there.
        env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const dir = (await new Response(proc.stdout).text()).trim();
    expect(dir.startsWith(join(root, "makamujo-game-"))).toBeTrue();
    expect(await proc.exited).toBe(0);
    expect(existsSync(dir)).toBeFalse();
  });
});

describe("createSweptTemporaryProfileDir", () => {
  it("sweeps abandoned leftovers before creating the new directory", () => {
    const root = makeRoot();
    const stale = mkdtempSync(join(root, "makamujo-game-"));
    stampOwner(stale, DEAD_PID);

    const dir = createSweptTemporaryProfileDir("makamujo-game-", root);
    try {
      expect(existsSync(stale)).toBeFalse();
      expect(existsSync(dir)).toBeTrue();
      expect(dir).not.toBe(stale);
    } finally {
      releaseTemporaryProfileDir(dir);
    }
  });
});
