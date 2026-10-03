/**
 * Lifecycle management for the throwaway Chromium profile directories this
 * project creates under the OS temp dir.
 *
 * The temp dir on the streaming host is tiny (~2 GB), so a profile that
 * survives a crash is not cosmetic: `bin/x/browser.ts` restarts the session in
 * a loop and every aborted run used to leak a fresh `makamujo-game-*`
 * directory. Cleanup therefore happens in three independent places:
 *
 * 1. the owner closes the browser (`releaseTemporaryProfileDir`),
 * 2. the process exits (`process.on("exit")` hook registered on first create),
 * 3. the next session start sweeps whatever is left over
 *    (`sweepStaleTemporaryProfileDirs`).
 *
 * (3) is what covers SIGKILL and power loss, which no handler can intercept.
 */
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Prefixes of temp directories owned by this project. */
export const MAKAMUJO_TEMP_PREFIXES = [
  "makamujo-game-",
  "makamujo-overlay-",
  "makamujo-browser-",
] as const;

export type MakamujoTempPrefix = (typeof MAKAMUJO_TEMP_PREFIXES)[number];

const OWNER_BASENAME = "makamujo-owner.json";

/**
 * Age after which an unrecognised directory (no readable owner marker) is
 * treated as abandoned. Guards against deleting a directory that a concurrent
 * process created moments ago but has not stamped yet.
 */
const DEFAULT_GRACE_MS = 60 * 60 * 1000;

const graceMs = (): number => {
  const raw = process.env.MAKAMUJO_TEMP_PROFILE_GRACE_MS;
  if (raw == null) return DEFAULT_GRACE_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_GRACE_MS;
};

/** Directories created by this process that have not been released yet. */
const liveDirectories = new Set<string>();

let exitHookInstalled = false;

const installExitHook = (): void => {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const dir of [...liveDirectories]) {
      releaseTemporaryProfileDir(dir);
    }
  });
};

/**
 * Whether `pid` still refers to a running process.
 *
 * `process.kill(pid, 0)` performs the permission/existence check without
 * delivering a signal. `EPERM` means the process exists but belongs to another
 * user, which still counts as alive.
 */
export const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
};

const readOwnerPid = (dir: string): number | undefined => {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(dir, OWNER_BASENAME), "utf8"),
    );
    if (typeof parsed !== "object" || parsed === null || !("pid" in parsed)) {
      return undefined;
    }
    const { pid } = parsed;
    return typeof pid === "number" ? pid : undefined;
  } catch {
    return undefined;
  }
};

const writeOwnerMarker = (dir: string): void => {
  try {
    writeFileSync(
      join(dir, OWNER_BASENAME),
      JSON.stringify({ pid: process.pid, createdAtMs: Date.now() }),
      { mode: 0o600 },
    );
  } catch (err) {
    console.warn(
      "[WARN] failed to stamp temporary profile owner:",
      dir,
      err instanceof Error ? err.message : String(err),
    );
  }
};

/**
 * Best-effort removal of a temp directory owned by this project.
 * Never throws, so cleanup failures cannot break the browser lifecycle.
 */
export const releaseTemporaryProfileDir = (dir: string): void => {
  liveDirectories.delete(dir);
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

/**
 * Create a temp profile directory stamped with the owning pid so that a later
 * {@link sweepStaleTemporaryProfileDirs} can tell abandoned directories from
 * ones a live browser is still using.
 */
export const createTemporaryProfileDir = (
  prefix: MakamujoTempPrefix,
  root: string = tmpdir(),
): string => {
  installExitHook();
  const dir = mkdtempSync(join(root, prefix));
  writeOwnerMarker(dir);
  liveDirectories.add(dir);
  return dir;
};

/** Temp profile directories created by this process that are still live. */
export const listLiveTemporaryProfileDirs = (): readonly string[] => [
  ...liveDirectories,
];

/**
 * Remove leftover temp profile directories that no live process owns.
 *
 * A directory is removed when its owner marker names a dead process, or when it
 * carries no readable marker and is older than the grace period. Directories
 * created by this process are always kept.
 *
 * @returns the removed directory paths.
 */
export const sweepStaleTemporaryProfileDirs = (
  root: string = tmpdir(),
  now: number = Date.now(),
): string[] => {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (err) {
    console.warn(
      "[WARN] failed to scan temp dir for stale profiles:",
      root,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    const prefix = MAKAMUJO_TEMP_PREFIXES.find((p) => entry.startsWith(p));
    if (prefix === undefined) continue;
    const dir = join(root, entry);
    if (liveDirectories.has(dir)) continue;

    const ownerPid = readOwnerPid(dir);
    if (ownerPid !== undefined) {
      if (isProcessAlive(ownerPid)) continue;
    } else {
      let mtimeMs: number;
      try {
        mtimeMs = statSync(dir).mtimeMs;
      } catch {
        continue;
      }
      if (now - mtimeMs < graceMs()) continue;
    }

    releaseTemporaryProfileDir(dir);
    removed.push(dir);
  }

  if (removed.length > 0) {
    console.warn(
      `[WARN] swept ${removed.length} abandoned temporary profile(s) from ${root}:`,
      removed,
    );
  }
  return removed;
};

/**
 * Sweep leftovers and then create a fresh temp profile directory.
 * Used at browser start-up so accumulated garbage never outlives a restart.
 */
export const createSweptTemporaryProfileDir = (
  prefix: MakamujoTempPrefix,
  root: string = tmpdir(),
): string => {
  sweepStaleTemporaryProfileDirs(root);
  return createTemporaryProfileDir(prefix, root);
};
