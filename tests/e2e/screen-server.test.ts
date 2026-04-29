import { expect, test } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import os from "os";

const RETRY_MS = 50;
const TIMEOUT_MS = 5000;

test("bin/start creates pid files and logs", async () => {
  const tmp = mkdtempSync(join(os.tmpdir(), "makamujo-screen-"));
  try {
    const tmpBin = join(tmp, "bin");
    const tmpPid = join(tmp, "var", "pid");
    const tmpVar = join(tmp, "var");
    mkdirSync(tmpBin, { recursive: true });
    mkdirSync(tmpPid, { recursive: true });
    mkdirSync(join(tmpBin, "x"), { recursive: true });

    // Copy the project's `bin/start` into the temp tree
    copyFileSync(join(process.cwd(), "bin", "start"), join(tmpBin, "start"));
    // Create a fake `obs` helper that just sleeps so the start script won't exec real OBS
    writeFileSync(join(tmpBin, "x", "obs"), "#!/usr/bin/env sh\nsleep 60\n");
    chmodSync(join(tmpBin, "x", "obs"), 0o755);

    // Create a fake `bun` executable that just sleeps (ignores args)
    const fakeBinDir = join(tmp, "fake-bin");
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(join(fakeBinDir, "bun"), "#!/usr/bin/env sh\n# fake bun: ignore args and sleep so nohup captures a long-running PID\nsleep 60\n");
    chmodSync(join(fakeBinDir, "bun"), 0o755);

    // Run the start script under the temp project root
    const env = { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}`, PROJECT_ROOT: tmp } as any;

    // Execute start via bash so relative paths resolve inside the temp tree
    const res = spawnSync("bash", [join(tmpBin, "start")], { env, cwd: tmp, stdio: "inherit" });
    expect(res.error).toBeUndefined();

    const screenPidPath = join(tmpPid, "screen");
    const browserPidPath = join(tmpPid, "browser");
    const obsPidPath = join(tmpPid, "obs");

    // Wait for PID files to appear
    const start = Date.now();
    while (Date.now() - start < TIMEOUT_MS) {
      if (existsSync(screenPidPath) && existsSync(browserPidPath) && existsSync(obsPidPath)) break;
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }

    expect(existsSync(screenPidPath)).toBeTruthy();
    expect(existsSync(browserPidPath)).toBeTruthy();
    expect(existsSync(obsPidPath)).toBeTruthy();

    const screenPid = readFileSync(screenPidPath, "utf-8").trim();
    expect(screenPid).toMatch(/^[0-9]+$/);

    // Check that the screen log file was created
    const screenLogPath = join(tmp, "var", "screen.log");
    expect(existsSync(screenLogPath)).toBeTruthy();

    // Cleanup: kill background processes if still running
    try { process.kill(parseInt(screenPid, 10)); } catch {}
    try { process.kill(parseInt(readFileSync(browserPidPath, "utf-8").trim(), 10)); } catch {}
    try { process.kill(parseInt(readFileSync(obsPidPath, "utf-8").trim(), 10)); } catch {}
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});
