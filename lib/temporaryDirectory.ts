import { lstatSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Scratch directory for synthesized speech WAV files. Owned by the long-running
 * server process, so it is only removed when that process exits.
 */
export const TTS_TEMPORARY_DIRECTORY_PREFIX = "makamujo-tts-";

/** Chromium profile of the game browser. Owned by `bin/x/browser.session.ts`. */
export const GAME_BROWSER_TEMPORARY_DIRECTORY_PREFIX = "makamujo-game-";

/** Chromium profile of the OBS overlay. Owned by `bin/x/overlay.ts`. */
export const OVERLAY_TEMPORARY_DIRECTORY_PREFIX = "makamujo-overlay-";

/** Fallback profile used when the requested profile dir is already locked. */
export const PLAYWRIGHT_FALLBACK_TEMPORARY_DIRECTORY_PREFIX =
  "makamujo-playwright-";

/**
 * Prefixes of the scratch directories owned by the browser processes this
 * project spawns, including the ones the browser libraries create on their own.
 *
 * A `SIGKILL`ed Chromium cannot clean up after itself, so `bin/stop` prunes
 * whatever survives once those processes are gone — the OS temp dir is only
 * 2 GB on the VPS and the profiles are tens of MB each.
 *
 * The TTS scratch directory is deliberately absent: `bin/stop` leaves the
 * server running, so it must not touch a directory that is still in use.
 */
export const BROWSER_TEMPORARY_DIRECTORY_PREFIXES = [
  GAME_BROWSER_TEMPORARY_DIRECTORY_PREFIX,
  OVERLAY_TEMPORARY_DIRECTORY_PREFIX,
  PLAYWRIGHT_FALLBACK_TEMPORARY_DIRECTORY_PREFIX,
  // playwright-core creates this scratch dir on every launch.
  "playwright-artifacts-",
  // puppeteer-extra-plugin-stealth creates this when no userDataDir is passed.
  "puppeteer_dev_profile-",
  // Chromium's own per-process scratch directories.
  "org.chromium.Chromium.",
] as const;

/** Create a fresh scratch directory under the OS temp dir. */
export const createTemporaryDirectory = (prefix: string): string =>
  mkdtempSync(join(tmpdir(), prefix));

/**
 * Best-effort removal of a temporary directory owned by this project (e.g. a
 * Chromium profile dir created with `mkdtempSync` under the OS temp dir).
 * Never throws, so cleanup failures cannot break the browser lifecycle.
 */
export const removeTemporaryDirectory = (dir: string): void => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(
      "[WARN] failed to remove temporary directory",
      dir,
      err instanceof Error ? err.message : String(err),
    );
  }
};

/** Whether `name` is a scratch directory name owned by the given prefixes. */
export const isOwnedTemporaryDirectoryName = (
  name: string,
  prefixes: readonly string[] = BROWSER_TEMPORARY_DIRECTORY_PREFIXES,
): boolean => prefixes.some((prefix) => name.startsWith(prefix));

/**
 * Remove the scratch directories left behind by terminated browser processes.
 *
 * Only call this once those processes are known to be gone: a live profile
 * directory being deleted underneath Chromium breaks its session.
 *
 * @returns the directories that were removed.
 */
export const removeStaleBrowserTemporaryDirectories = (
  root: string = tmpdir(),
): string[] => {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (err) {
    console.warn(
      "[WARN] failed to read the temporary directory root",
      root,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!isOwnedTemporaryDirectoryName(entry)) continue;
    const path = join(root, entry);
    try {
      // Symlinks are skipped: only real directories are ours to delete.
      if (!lstatSync(path).isDirectory()) continue;
    } catch {
      // Vanished between readdir and lstat (or unreadable): nothing to do.
      continue;
    }
    removeTemporaryDirectory(path);
    removed.push(path);
  }
  return removed;
};
