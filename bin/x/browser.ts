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
const FORCE_KILL_AFTER_MS = Number.parseInt(
  process.env.BROWSER_FORCE_KILL_AFTER_MS ?? "10000",
  10,
);
const RAPID_WINDOW_MS = 60_000;

const recent: number[] = [];

function noteRestart(): void {
  const now = Date.now();
  recent.push(now);
  while (recent.length > 0) {
    const oldest = recent[0];
    if (oldest === undefined || now - oldest <= RAPID_WINDOW_MS) break;
    recent.shift();
  }
  if (recent.length > MAX_RAPID) {
    console.error(
      `[ERROR] browser restarted ${recent.length} times in ${RAPID_WINDOW_MS}ms; giving up`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  let shuttingDown = false;
  let session: Bun.Subprocess | null = null;

  // Without this, systemd's SIGTERM only reaches the supervisor: the session
  // and its Chromium keep running and leak their temp directories.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log("[INFO] supervisor received", signal);
      const stop = async () => {
        const child = session;
        if (!child) return;
        child.kill(signal);
        const exited = await Promise.race([
          child.exited,
          sleep(FORCE_KILL_AFTER_MS).then(() => "timed-out" as const),
        ]);
        if (exited === "timed-out") {
          console.warn(
            `[WARN] browser session did not exit in ${FORCE_KILL_AFTER_MS}ms, sending SIGKILL`,
          );
          child.kill("SIGKILL");
          await child.exited;
        }
      };
      void stop().finally(() => process.exit(0));
    });
  }

  for (;;) {
    if (shuttingDown) return;
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
      session = proc;
      const code = await proc.exited;
      session = null;
      console.warn(`[WARN] browser session exited code=${code}`);
    } catch (err) {
      console.error("[ERROR] browser session error", err);
    }
    if (shuttingDown) return;
    noteRestart();
    console.log(`[INFO] relaunching browser in ${RESTART_DELAY_MS}ms`);
    await sleep(RESTART_DELAY_MS);
  }
}

await main();
