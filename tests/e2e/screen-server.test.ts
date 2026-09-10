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

test("bin/start starts screen, browser and OBS via systemctl", async () => {
  const tmp = mkdtempSync(join(os.tmpdir(), "makamujo-screen-"));
  try {
    const tmpBin = join(tmp, "bin");
    mkdirSync(tmpBin, { recursive: true });
    mkdirSync(join(tmpBin, "x"), { recursive: true });
    mkdirSync(join(tmp, "var"), { recursive: true });

    copyFileSync(join(process.cwd(), "bin", "start"), join(tmpBin, "start"));
    writeFileSync(join(tmpBin, "x", "obs"), "#!/usr/bin/env sh\nsleep 60\n");
    chmodSync(join(tmpBin, "x", "obs"), 0o755);

    const fakeBinDir = join(tmp, "fake-bin");
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(join(fakeBinDir, "bun"), "#!/usr/bin/env sh\nsleep 60\n");
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
    } as NodeJS.ProcessEnv;

    const res = spawnSync("bash", [join(tmpBin, "start")], {
      env,
      cwd: tmp,
      stdio: "inherit",
    });
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(0);

    expect(existsSync(systemctlLog)).toBeTruthy();
    const log = readFileSync(systemctlLog, "utf-8");
    expect(log).toMatch(/start\s+makamujo-screen\.service/);
    expect(log).toMatch(/start\s+makamujo-browser\.service/);
    expect(log).toMatch(/start\s+makamujo-obs\.service/);
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
});
