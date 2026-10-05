import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  BROWSER_TEMPORARY_DIRECTORY_PREFIXES,
  createTemporaryDirectory,
  GAME_BROWSER_TEMPORARY_DIRECTORY_PREFIX,
  isOwnedTemporaryDirectoryName,
  OVERLAY_TEMPORARY_DIRECTORY_PREFIX,
  PLAYWRIGHT_FALLBACK_TEMPORARY_DIRECTORY_PREFIX,
  removeStaleBrowserTemporaryDirectories,
  removeTemporaryDirectory,
  TTS_TEMPORARY_DIRECTORY_PREFIX,
} from "./temporaryDirectory";

const created: string[] = [];
const roots: string[] = [];

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "makamujo-tmp-root-"));
  roots.push(root);
  return root;
};

const makeOwnedDir = (root: string, prefix: string): string => {
  const dir = join(root, `${prefix}abcdef`);
  mkdirSync(join(dir, "Default"), { recursive: true });
  writeFileSync(join(dir, "Default", "Preferences"), "{}");
  created.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of created.splice(0)) {
    removeTemporaryDirectory(dir);
  }
  for (const root of roots.splice(0)) {
    removeTemporaryDirectory(root);
  }
});

describe("createTemporaryDirectory", () => {
  it("creates a fresh directory named after the prefix", () => {
    const dir = createTemporaryDirectory(
      GAME_BROWSER_TEMPORARY_DIRECTORY_PREFIX,
    );
    created.push(dir);
    expect(existsSync(dir)).toBe(true);
    expect(
      basename(dir).startsWith(GAME_BROWSER_TEMPORARY_DIRECTORY_PREFIX),
    ).toBe(true);
  });

  it("never reuses a previous directory", () => {
    const first = createTemporaryDirectory(OVERLAY_TEMPORARY_DIRECTORY_PREFIX);
    const second = createTemporaryDirectory(OVERLAY_TEMPORARY_DIRECTORY_PREFIX);
    created.push(first, second);
    expect(first).not.toBe(second);
  });
});

describe("removeTemporaryDirectory", () => {
  it("removes the directory when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "makamujo-tmp-remove-"));
    created.push(dir);
    expect(existsSync(dir)).toBe(true);
    removeTemporaryDirectory(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it("removes the directory recursively when non-empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "makamujo-tmp-remove-"));
    created.push(dir);
    mkdirSync(join(dir, "Default", "Cache"), { recursive: true });
    writeFileSync(join(dir, "Default", "Preferences"), "x");
    removeTemporaryDirectory(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it("never throws for a missing directory", () => {
    expect(() =>
      removeTemporaryDirectory(join(tmpdir(), "missing-makamujo-profile")),
    ).not.toThrow();
  });

  it("leaves directories outside the OS temp dir alone", () => {
    // Fixture lives in var/ (not the OS temp dir), so only the explicit
    // rmSync below may delete it — not the function under test.
    const dir = join(
      process.cwd(),
      "var",
      `temporary-directory-outside-${Date.now().toString(36)}`,
    );
    mkdirSync(dir, { recursive: true });
    try {
      removeTemporaryDirectory(dir);
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isOwnedTemporaryDirectoryName", () => {
  it("accepts the browser-owned prefixes", () => {
    for (const prefix of BROWSER_TEMPORARY_DIRECTORY_PREFIXES) {
      expect(isOwnedTemporaryDirectoryName(`${prefix}abc123`)).toBe(true);
    }
  });

  it("rejects unrelated names", () => {
    expect(isOwnedTemporaryDirectoryName("systemd-private-xyz")).toBe(false);
    expect(isOwnedTemporaryDirectoryName("hsperfdata_root")).toBe(false);
    expect(isOwnedTemporaryDirectoryName(".X11-unix")).toBe(false);
  });

  it("rejects the server-owned TTS scratch dir", () => {
    // bin/stop leaves the server running, so its scratch dir is not ours to
    // delete even though the prefix looks like ours.
    expect(isOwnedTemporaryDirectoryName("makamujo-tts-abc123")).toBe(false);
    expect(isOwnedTemporaryDirectoryName("makamujo-abc123")).toBe(false);
  });

  it("honors an explicit prefix list", () => {
    expect(
      isOwnedTemporaryDirectoryName("other-thing", [
        TTS_TEMPORARY_DIRECTORY_PREFIX,
      ]),
    ).toBe(false);
    expect(
      isOwnedTemporaryDirectoryName("makamujo-tts-abc", [
        TTS_TEMPORARY_DIRECTORY_PREFIX,
      ]),
    ).toBe(true);
  });
});

describe("removeStaleBrowserTemporaryDirectories", () => {
  it("removes every browser-owned directory under the given root", () => {
    const root = makeRoot();
    for (const prefix of BROWSER_TEMPORARY_DIRECTORY_PREFIXES) {
      makeOwnedDir(root, prefix);
    }

    const removed = removeStaleBrowserTemporaryDirectories(root);

    expect(removed).toHaveLength(BROWSER_TEMPORARY_DIRECTORY_PREFIXES.length);
    for (const dir of removed) {
      expect(existsSync(dir)).toBe(false);
    }
  });

  it("keeps directories it does not own", () => {
    const root = makeRoot();
    const foreign = mkdirSync(join(root, "systemd-private-abc"), {
      recursive: true,
    });
    const serverOwned = mkdirSync(
      join(root, `${TTS_TEMPORARY_DIRECTORY_PREFIX}abc`),
      {
        recursive: true,
      },
    );

    const removed = removeStaleBrowserTemporaryDirectories(root);

    expect(removed).toBeEmpty();
    expect(existsSync(foreign as string)).toBe(true);
    expect(existsSync(serverOwned as string)).toBe(true);
  });

  it("keeps plain files and symlinks that share an owned prefix", () => {
    const root = makeRoot();
    const file = join(
      root,
      `${PLAYWRIGHT_FALLBACK_TEMPORARY_DIRECTORY_PREFIX}abc`,
    );
    writeFileSync(file, "not a directory");
    const link = join(root, `${GAME_BROWSER_TEMPORARY_DIRECTORY_PREFIX}abc`);
    const target = makeRoot();
    if (link !== undefined) {
      symlinkSync(target, link, "junction");
    }

    removeStaleBrowserTemporaryDirectories(root);

    expect(existsSync(file)).toBe(true);
    if (link !== undefined) {
      expect(existsSync(link)).toBe(true);
    }
    expect(existsSync(target)).toBe(true);
  });

  it("refuses a sibling root that merely shares the temp dir's prefix", () => {
    // `/tmp-evil` starts with `/tmp`, so a bare prefix comparison would let it
    // through; the remainder must be empty or start with a separator.
    const sibling = `${resolve(tmpdir())}-evil`;
    const stale = join(
      sibling,
      `${GAME_BROWSER_TEMPORARY_DIRECTORY_PREFIX}abc`,
    );
    mkdirSync(stale, { recursive: true });
    try {
      expect(removeStaleBrowserTemporaryDirectories(sibling)).toBeEmpty();
      expect(existsSync(stale)).toBe(true);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it("returns nothing when the root does not exist", () => {
    expect(
      removeStaleBrowserTemporaryDirectories(
        join(tmpdir(), "makamujo-missing-tmp-root"),
      ),
    ).toBeEmpty();
  });

  it("refuses to sweep a root outside the OS temp dir", () => {
    // Fixture lives in var/ (not the OS temp dir), so only the explicit
    // rmSync below may delete it — not the function under test.
    const root = join(
      process.cwd(),
      "var",
      `temporary-directory-outside-root-${Date.now().toString(36)}`,
    );
    const stale = join(
      root,
      `${GAME_BROWSER_TEMPORARY_DIRECTORY_PREFIX}abcdef`,
    );
    mkdirSync(join(stale, "Default"), { recursive: true });
    try {
      expect(removeStaleBrowserTemporaryDirectories(root)).toBeEmpty();
      expect(existsSync(stale)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
