#!/usr/bin/env bun
import { tmpdir } from "node:os";
/**
 * Remove the scratch directories that browser processes left in the OS temp
 * dir. A `SIGKILL`ed Chromium cannot clean up after itself, and the VPS only
 * has a 2 GB temp filesystem, so `bin/stop` runs this once it has terminated
 * the browser sessions.
 *
 * Usage: bun bin/cleanup-temp.ts [root]   (root defaults to the OS temp dir)
 */
import {
  removeStaleBrowserTemporaryDirectories,
  TTS_TEMPORARY_DIRECTORY_PREFIX,
} from "../lib/temporaryDirectory";

const root = process.argv[2] ?? tmpdir();
const removed = removeStaleBrowserTemporaryDirectories(root);

for (const dir of removed) {
  console.log("[INFO] removed stale temporary directory", dir);
}
if (removed.length === 0) {
  console.log("[INFO] no stale browser temporary directories in", root);
}
console.log(
  `[INFO] kept ${TTS_TEMPORARY_DIRECTORY_PREFIX}* (owned by the running server)`,
);
