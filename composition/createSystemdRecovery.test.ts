import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { createSystemdRecovery } from "./broadcastFreezeWatchdog";

const silentLog = { log: () => {}, warn: () => {}, error: () => {} };

describe("createSystemdRecovery", () => {
  let tmp: string;
  let originalPath: string | undefined;
  let systemctlLog: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(os.tmpdir(), "systemd-recovery-"));
    const fakeBin = join(tmp, "bin");
    mkdirSync(fakeBin, { recursive: true });
    systemctlLog = join(tmp, "systemctl.log");
    writeFileSync(
      join(fakeBin, "systemctl"),
      `#!/usr/bin/env sh\necho "$@" >> "${systemctlLog}"\nexit 0\n`,
    );
    chmodSync(join(fakeBin, "systemctl"), 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${process.env.PATH ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("dry run touches no unit and exits nothing", async () => {
    const exits: number[] = [];
    const recovery = createSystemdRecovery({
      dryRun: true,
      exit: (code?: number) => exits.push(code ?? -1),
      sleep: async () => {},
      log: silentLog,
    });

    await recovery("browserAndBroadcastStack");

    expect(exits).toEqual([]);
  });

  it("restarts only the external units for obs recovery", async () => {
    const exits: number[] = [];
    const recovery = createSystemdRecovery({
      dryRun: false,
      exit: (code?: number) => exits.push(code ?? -1),
      sleep: async () => {},
      log: silentLog,
    });

    await recovery("obs");

    const log = readFileSync(systemctlLog, "utf-8");
    expect(log).toContain("restart makamujo-obs.service");
    expect(exits).toEqual([]);
  });

  it("restarts external units then exits 1 for the host recovery", async () => {
    const exits: number[] = [];
    const recovery = createSystemdRecovery({
      dryRun: false,
      exit: (code?: number) => exits.push(code ?? -1),
      sleep: async () => {},
      log: silentLog,
    });

    await recovery("browserAndBroadcastStack");

    const log = readFileSync(systemctlLog, "utf-8");
    expect(log).toContain("restart makamujo-xvfb.service");
    expect(log).toContain("restart makamujo-browser.service");
    expect(log).toContain("restart makamujo-obs.service");
    expect(log).not.toContain("restart makamujo-screen.service");
    expect(exits).toEqual([1]);
  });
});
