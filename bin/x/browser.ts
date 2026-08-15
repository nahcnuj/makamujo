#!/usr/bin/env bun
/**
 * Game browser with auto-restart on crash.
 * bin/start runs this file; on Chromium/Playwright death we relaunch.
 */
import { setTimeout as sleep } from "node:timers/promises";

const RESTART_DELAY_MS = Number.parseInt(
  process.env.BROWSER_RESTART_DELAY_MS ?? "3000",
  10,
);
const MAX_RAPID = Number.parseInt(
  process.env.BROWSER_RESTART_MAX_RAPID ?? "10",
  10,
);
const RAPID_WINDOW_MS = 60_000;

const recent: number[] = [];

function noteRestart(): void {
  const now = Date.now();
  recent.push(now);
  while (recent.length && now - recent[0]! > RAPID_WINDOW_MS) recent.shift();
  if (recent.length > MAX_RAPID) {
    console.error(
      `[ERROR] browser restarted ${recent.length} times in ${RAPID_WINDOW_MS}ms; giving up`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  for (;;) {
    try {
      console.log("[INFO] browser session starting");
      // Run original entry as a subprocess so its process.exit / crash is isolated
      const proc = Bun.spawn({
        cmd: [
          process.execPath,
          `${import.meta.dir}/browser.session.ts`,
          ...process.argv.slice(2),
        ],
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
        env: process.env,
      });
      const code = await proc.exited;
      console.warn(`[WARN] browser session exited code=${code}`);
    } catch (err) {
      console.error("[ERROR] browser session error", err);
    }
    noteRestart();
    console.log(`[INFO] relaunching browser in ${RESTART_DELAY_MS}ms`);
    await sleep(RESTART_DELAY_MS);
  }
}

await main();
