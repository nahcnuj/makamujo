import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BROWSER_TEMPORARY_DIRECTORY_PREFIXES } from "../lib/temporaryDirectory";

const read = (path: string): string => readFileSync(path, "utf-8");

/**
 * The temp directories the project creates under `/tmp` are only as good as
 * the code that removes them again: the VPS temp filesystem is 2 GB and a
 * Chromium profile is tens of MB. These assertions pin the cleanup wiring
 * that cannot be observed without launching a real browser.
 */
describe("temporary directory ownership", () => {
  test("the game browser session closes the browser on stop signals", () => {
    const session = read("bin/x/browser.session.ts");

    // `process.on("exit")` does not run for signals, and the session idles in
    // a long timeout, so systemd's SIGTERM would skip the cleanup entirely.
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      expect(session).toContain(`"${signal}"`);
    }
    expect(session).toContain("await closeBrowser();");
    expect(session).toContain("let closed = false;");
  });

  test("the browser supervisor forwards stop signals to its session", () => {
    const supervisor = read("bin/x/browser.ts");

    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      expect(supervisor).toContain(`"${signal}"`);
    }
    expect(supervisor).toContain("child.kill(signal);");
    // The supervisor must not treat its own shutdown as a crash.
    expect(supervisor).toContain("shuttingDown = true;");
    expect(supervisor).toContain("if (shuttingDown) return;");
  });

  test("the overlay browser closes the browser on stop signals", () => {
    const overlay = read("bin/x/overlay.ts");

    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      expect(overlay).toContain(`"${signal}"`);
    }
    expect(overlay).toContain("removeTemporaryDirectory(userDataDir);");
  });

  test("a failed Chromium launch removes the profile it created", () => {
    const chromium = read("lib/Browser/chromium.ts");
    const launches = chromium.match(/\.launchPersistentContext\(/g) ?? [];

    // create() and the locked-profile fallback all have to clean up after a
    // rejected launch.
    expect(launches.length).toBeGreaterThanOrEqual(3);
    expect(
      chromium.match(/\.catch\(\(err: unknown\) => \{/g) ?? [],
    ).toHaveLength(1);
    expect(chromium).toContain(
      "Never leave the fallback profile behind when the launch fails.",
    );
    expect(chromium).toContain(
      "// A failed launch must not leave the profile behind",
    );
  });

  test("the stealth plugin writes into the profile we already own", () => {
    const chromium = read("lib/Browser/chromium.ts");

    // Without userDataDir, puppeteer-extra-plugin-stealth mkdtemps a
    // `puppeteer_dev_profile-*` directory per launch and only removes it on a
    // graceful disconnect.
    expect(chromium).toContain("withOwnedUserDataDir(launchOpts, userDataDir)");
    expect(chromium).toContain("withOwnedUserDataDir(launchOpts, tmpDir)");
  });

  test("the server releases its TTS scratch directory on exit", () => {
    const entry = read("index.ts");
    const tts = read("lib/TTS/index.ts");

    expect(entry).toContain("tts.close?.();");
    expect(tts).toContain("TTS_TEMPORARY_DIRECTORY_PREFIX");
    expect(tts).toContain("removeTemporaryDirectory(tempDir);");
  });

  test("the server survives the stop signal systemd sends it", () => {
    const entry = read("index.ts");

    // SIGTERM is what `systemctl stop makamujo-screen.service` (and so
    // `bin/stop`) delivers. Without a listener the process dies without running
    // the "exit" hook, so the TTS scratch directory would survive every stop.
    expect(entry).toContain(
      'process.on("SIGTERM", signalHandler.bind(null, { exit: true }));',
    );
    expect(entry).toContain(
      'process.on("SIGHUP", signalHandler.bind(null, { exit: true }));',
    );
  });

  test("make install ships the temp sweep that bin/stop shells out to", () => {
    const makefile = read("Makefile");

    // bin/stop resolves ${PROJECT_ROOT}/bin/cleanup-temp.ts and swallows the
    // failure, so a missing file would silently disable the whole sweep.
    expect(makefile).toContain("bin/cleanup-temp.ts");
    const installBin = makefile
      .split("\n")
      .find((line) => line.startsWith("INSTALL_BIN"));
    expect(installBin).toContain("bin/cleanup-temp.ts");
  });

  test("bin/stop prunes the browser scratch directories through bin/cleanup-temp", () => {
    const stop = read("bin/stop");

    expect(stop).toContain("sweep_temporary_directories");
    expect(stop).toContain('bin/cleanup-temp.ts" "${TMPDIR:-/tmp}"');
    // Only after the browser processes are gone.
    expect(stop.indexOf("sweep_leftovers")).toBeLessThan(
      stop.lastIndexOf("sweep_temporary_directories"),
    );
  });

  test("bin/cleanup-temp leaves the running server's scratch dir alone", () => {
    const cleanup = read("bin/cleanup-temp.ts");

    expect(cleanup).toContain("removeStaleBrowserTemporaryDirectories(root)");
    expect(BROWSER_TEMPORARY_DIRECTORY_PREFIXES).not.toContain("makamujo-tts-");
  });
});
