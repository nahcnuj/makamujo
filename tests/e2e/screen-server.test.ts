import { expect, test } from "@playwright/test";
import { spawnSync } from "child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import os from "os";
import { join } from "path";

const RETRY_MS = 50;
const TIMEOUT_MS = 5000;

test("bin/start creates pid files and starts OBS via systemctl", async () => {
  const tmp = mkdtempSync(join(os.tmpdir(), "makamujo-screen-"));
  try {
    const tmpBin = join(tmp, "bin");
    const tmpPid = join(tmp, "var", "pid");
    mkdirSync(tmpBin, { recursive: true });
    mkdirSync(tmpPid, { recursive: true });
    mkdirSync(join(tmpBin, "x"), { recursive: true });

    copyFileSync(join(process.cwd(), "bin", "start"), join(tmpBin, "start"));
    // OBS binary is unused when systemctl path is taken; keep a stub anyway
    writeFileSync(join(tmpBin, "x", "obs"), "#!/usr/bin/env sh\nsleep 60\n");
    chmodSync(join(tmpBin, "x", "obs"), 0o755);

    const fakeBinDir = join(tmp, "fake-bin");
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(
      join(fakeBinDir, "bun"),
      "#!/usr/bin/env sh\n# fake bun: ignore args and sleep so nohup captures a long-running PID\nsleep 60\n",
    );
    chmodSync(join(fakeBinDir, "bun"), 0o755);

    const systemctlLog = join(tmp, "systemctl.log");
    writeFileSync(
      join(fakeBinDir, "systemctl"),
      `#!/usr/bin/env sh
echo "$@" >> "${systemctlLog}"
exit 0
`,
    );
    chmodSync(join(fakeBinDir, "systemctl"), 0o755);

    const env = {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      PROJECT_ROOT: tmp,
    } as NodeJS.ProcessEnv;

    const res = spawnSync("bash", [join(tmpBin, "start")], {
      env,
      cwd: tmp,
      stdio: "inherit",
    });
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(0);

    const screenPidPath = join(tmpPid, "screen");
    const browserPidPath = join(tmpPid, "browser");
    const obsPidPath = join(tmpPid, "obs");

    const start = Date.now();
    while (Date.now() - start < TIMEOUT_MS) {
      if (existsSync(screenPidPath) && existsSync(browserPidPath)) break;
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }

    expect(existsSync(screenPidPath)).toBeTruthy();
    expect(existsSync(browserPidPath)).toBeTruthy();
    // OBS is managed by systemd; no pid file from bin/start
    expect(existsSync(obsPidPath)).toBeFalsy();

    const screenPid = readFileSync(screenPidPath, "utf-8").trim();
    expect(screenPid).toMatch(/^[0-9]+$/);

    const screenLogPath = join(tmp, "var", "screen.log");
    expect(existsSync(screenLogPath)).toBeTruthy();

    expect(existsSync(systemctlLog)).toBeTruthy();
    const log = readFileSync(systemctlLog, "utf-8");
    expect(log).toMatch(/start\s+makamujo-obs\.service/);

    try {
      process.kill(parseInt(screenPid, 10));
    } catch {}
    try {
      process.kill(parseInt(readFileSync(browserPidPath, "utf-8").trim(), 10));
    } catch {}
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
});
