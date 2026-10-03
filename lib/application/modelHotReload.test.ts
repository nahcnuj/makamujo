import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isSameStamp,
  type ModelFileStamp,
  readModelFileStamp,
  startModelHotReload,
} from "./modelHotReload";

const tempDirs: string[] = [];

const makeModelFile = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "model-hot-reload-"));
  tempDirs.push(dir);
  const path = join(dir, "model.json");
  writeFileSync(path, body, "utf8");
  return path;
};

/**
 * Fixed timestamp used to make a rewrite observable on filesystems with coarse
 * mtime resolution. Pinning it means no prior stat is needed, so there is no
 * check-then-write race (and CodeQL does not flag the test).
 */
const PINNED_MTIME = new Date("2030-01-01T00:00:00Z");

/** Rewrite the file so both size and mtime differ from the previous content. */
const rewrite = (path: string, body: string): ModelFileStamp => {
  writeFileSync(path, body, "utf8");
  utimesSync(path, PINNED_MTIME, PINNED_MTIME);
  const stamp = readModelFileStamp(path);
  if (stamp === undefined) {
    throw new Error(`rewrite could not stat ${path}`);
  }
  return stamp;
};

const createWatcher = (
  path: string,
  onReload: (stamp: ModelFileStamp) => void,
  pollIntervalMs = 5,
) => startModelHotReload({ modelPath: path, onReload, pollIntervalMs });

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("isSameStamp", () => {
  it("treats two missing files as equal", () => {
    expect(isSameStamp(undefined, undefined)).toBeTrue();
  });

  it("distinguishes a missing file from a present one", () => {
    expect(isSameStamp(undefined, { mtimeMs: 1, size: 1 })).toBeFalse();
    expect(isSameStamp({ mtimeMs: 1, size: 1 }, undefined)).toBeFalse();
  });

  it("requires both mtime and size to match", () => {
    expect(
      isSameStamp({ mtimeMs: 1, size: 2 }, { mtimeMs: 1, size: 2 }),
    ).toBeTrue();
    expect(
      isSameStamp({ mtimeMs: 1, size: 2 }, { mtimeMs: 9, size: 2 }),
    ).toBeFalse();
    expect(
      isSameStamp({ mtimeMs: 1, size: 2 }, { mtimeMs: 1, size: 9 }),
    ).toBeFalse();
  });
});

describe("readModelFileStamp", () => {
  it("reads size and mtime of an existing file", () => {
    const path = makeModelFile("{}");
    expect(readModelFileStamp(path)).toEqual({
      mtimeMs: statSync(path).mtimeMs,
      size: 2,
    });
  });

  it("returns undefined for a missing file", () => {
    expect(
      readModelFileStamp(join(tmpdir(), "no-such-model.json")),
    ).toBeUndefined();
  });
});

describe("startModelHotReload", () => {
  it("does not fire for the file it started with", () => {
    const path = makeModelFile("{}");
    let calls = 0;
    const watcher = createWatcher(path, () => {
      calls += 1;
    });
    try {
      for (let i = 0; i < 5; i++) watcher.poll();
      expect(calls).toBe(0);
    } finally {
      watcher.stop();
    }
  });

  it("fires once an external change is confirmed on two samples", () => {
    const path = makeModelFile("{}");
    const stamps: ModelFileStamp[] = [];
    const watcher = createWatcher(path, (stamp) => {
      stamps.push(stamp);
    });
    try {
      const next = rewrite(path, '{"model":{}}');
      watcher.poll(); // first sighting of the new content
      expect(stamps).toHaveLength(0);
      watcher.poll(); // unchanged since the last sample -> confirmed
      expect(stamps).toEqual([next]);
    } finally {
      watcher.stop();
    }
  });

  it("does not fire again while the content stays put", () => {
    const path = makeModelFile("{}");
    let calls = 0;
    const watcher = createWatcher(path, () => {
      calls += 1;
    });
    try {
      rewrite(path, '{"model":{}}');
      watcher.poll();
      watcher.poll();
      expect(calls).toBe(1);
      for (let i = 0; i < 5; i++) watcher.poll();
      expect(calls).toBe(1);
    } finally {
      watcher.stop();
    }
  });

  it("waits for a write that is still in progress to settle", () => {
    const path = makeModelFile("{}");
    let calls = 0;
    const watcher = createWatcher(path, () => {
      calls += 1;
    });
    try {
      // An editor that truncates and then appends produces two intermediate
      // contents; only the settled one may trigger a reload.
      const first = rewrite(path, '{"model"');
      watcher.poll();
      const second = rewrite(path, '{"model":{"a":1}}');
      watcher.poll();
      expect(calls).toBe(0);
      watcher.poll();
      expect(calls).toBe(1);
      expect(first.size).not.toBe(second.size);
    } finally {
      watcher.stop();
    }
  });

  it("ignores a write the application reported itself", () => {
    const path = makeModelFile("{}");
    let calls = 0;
    const watcher = createWatcher(path, () => {
      calls += 1;
    });
    try {
      // The server persists the model after every comment batch; those writes
      // must never rebuild the agent.
      watcher.noteSelfWrite(rewrite(path, '{"model":{"persisted":1}}'));
      for (let i = 0; i < 5; i++) watcher.poll();
      expect(calls).toBe(0);
      expect(watcher.lastStamp?.size).toBe(readModelFileStamp(path)?.size ?? 0);
    } finally {
      watcher.stop();
    }
  });

  it("noteSelfWrite without a stamp stats the file itself", () => {
    const path = makeModelFile("{}");
    let calls = 0;
    const watcher = createWatcher(path, () => {
      calls += 1;
    });
    try {
      rewrite(path, '{"model":{"persisted":1}}');
      watcher.noteSelfWrite();
      for (let i = 0; i < 5; i++) watcher.poll();
      expect(calls).toBe(0);
    } finally {
      watcher.stop();
    }
  });

  it("still reloads for an external write that follows a self write", () => {
    const path = makeModelFile("{}");
    let calls = 0;
    const watcher = createWatcher(path, () => {
      calls += 1;
    });
    try {
      watcher.noteSelfWrite(rewrite(path, '{"model":{"persisted":1}}'));
      watcher.poll();
      rewrite(path, '{"model":{"hand-edited":1}}');
      watcher.poll();
      watcher.poll();
      expect(calls).toBe(1);
    } finally {
      watcher.stop();
    }
  });

  it("keeps the loaded model when the file disappears", () => {
    const path = makeModelFile("{}");
    let calls = 0;
    const watcher = createWatcher(path, () => {
      calls += 1;
    });
    try {
      rmSync(path, { force: true });
      watcher.poll();
      watcher.poll();
      expect(calls).toBe(0);
      expect(watcher.lastStamp).toBeUndefined();
    } finally {
      watcher.stop();
    }
  });

  it("polls on its own interval", async () => {
    const path = makeModelFile("{}");
    let calls = 0;
    const watcher = createWatcher(path, () => {
      calls += 1;
    });
    try {
      rewrite(path, '{"model":{}}');
      await Bun.sleep(60);
      expect(calls).toBe(1);
    } finally {
      watcher.stop();
    }
  });

  it("stop halts further polls", async () => {
    const path = makeModelFile("{}");
    let calls = 0;
    const watcher = createWatcher(path, () => {
      calls += 1;
    });
    watcher.stop();
    rewrite(path, '{"model":{}}');
    await Bun.sleep(40);
    expect(calls).toBe(0);
  });

  it("keeps polling after onReload throws", () => {
    const path = makeModelFile("{}");
    let calls = 0;
    const watcher = createWatcher(path, () => {
      calls += 1;
      throw new Error("boom");
    });
    try {
      rewrite(path, '{"model":{}}');
      expect(() => {
        watcher.poll();
        watcher.poll();
      }).not.toThrow();
      expect(calls).toBe(1);
    } finally {
      watcher.stop();
    }
  });
});
