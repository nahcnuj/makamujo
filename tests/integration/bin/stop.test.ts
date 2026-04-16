import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("waits until a killed process disappears before finishing", () => {
  const temporaryProjectRoot = mkdtempSync(join(tmpdir(), "stop-test-"));
  const temporaryBinDirectory = join(temporaryProjectRoot, "bin");
  const temporaryPidDirectory = join(temporaryProjectRoot, "var", "pid");
  const fakeBinaryDirectory = join(temporaryProjectRoot, "fake-bin");
  const fakeStateDirectory = join(temporaryProjectRoot, "fake-state");
  const temporaryStopScriptPath = join(temporaryBinDirectory, "stop");
  const pidFilePath = join(temporaryPidDirectory, "screen");
  const fakeKillScriptPath = join(fakeBinaryDirectory, "kill");
  const fakePgrepScriptPath = join(fakeBinaryDirectory, "pgrep");

  try {
    mkdirSync(temporaryBinDirectory, { recursive: true });
    mkdirSync(temporaryPidDirectory, { recursive: true });
    mkdirSync(fakeBinaryDirectory, { recursive: true });
    mkdirSync(fakeStateDirectory, { recursive: true });

    cpSync(join(process.cwd(), "bin", "stop"), temporaryStopScriptPath);
    chmodSync(temporaryStopScriptPath, 0o755);

    writeFileSync(pidFilePath, "123");

    writeFileSync(
      fakeKillScriptPath,
      `#!/usr/bin/env sh
set -eu
state_dir='${fakeStateDirectory}'
signal=$1
pid=$2
state_file="$state_dir/$pid"

if [ "$signal" = "-KILL" ]; then
  echo 3 > "$state_file"
  exit 0
fi

if [ "$signal" = "-0" ]; then
  if [ ! -f "$state_file" ]; then
    exit 1
  fi

  retries=$(cat "$state_file")
  if [ "$retries" -gt 0 ]; then
    echo $((retries - 1)) > "$state_file"
    exit 0
  fi

  rm -f "$state_file"
  exit 1
fi

exit 0
`,
    );
    chmodSync(fakeKillScriptPath, 0o755);

    writeFileSync(fakePgrepScriptPath, "#!/usr/bin/env sh\nexit 1\n");
    chmodSync(fakePgrepScriptPath, 0o755);

    const startedAt = Date.now();
    const result = spawnSync("bash", ["-c", 'enable -n kill; source "$0"', temporaryStopScriptPath], {
      env: {
        ...process.env,
        PATH: `${fakeBinaryDirectory}:${process.env.PATH ?? ""}`,
      },
      encoding: "utf-8",
    });
    const elapsedMilliseconds = Date.now() - startedAt;

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(existsSync(pidFilePath)).toBe(false);
    expect(elapsedMilliseconds).toBeGreaterThanOrEqual(200);
  } finally {
    rmSync(temporaryProjectRoot, { recursive: true, force: true });
  }
});
