import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { resolveExecutablePath } from "./chromium";
import { createReceiverWithPath, removeStaleUnixIpcSocket } from "./socket";

describe("resolveExecutablePath containment", () => {
  it("allows an existing path under an allowlisted root (process.execPath)", () => {
    const exec = process.execPath;
    expect(resolveExecutablePath(exec)).toBe(resolve(exec));
  });

  it("denies an existing path outside allowlisted roots", () => {
    // System binaries sit outside our allowlist (homedir/tmpdir/exec dir/…).
    const outside =
      process.platform === "win32"
        ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe")
        : "/etc/passwd";
    expect(existsSync(outside)).toBe(true);
    expect(resolveExecutablePath(outside)).toBeUndefined();
  });

  it("returns undefined for a missing path under an allowlisted root", () => {
    const missing = join(
      dirname(process.execPath),
      "makamujo-missing-chrome-binary",
    );
    expect(existsSync(missing)).toBe(false);
    expect(resolveExecutablePath(missing)).toBeUndefined();
  });
});

describe("removeStaleUnixIpcSocket / createReceiverWithPath containment", () => {
  const varDir = join(process.cwd(), "var");
  const staleName = `path-containment-${Date.now().toString(36)}.sock`;
  const staleUnderVar = join(varDir, staleName);
  let outsideDir = "";
  let outsideSock = "";

  afterEach(() => {
    for (const p of [staleUnderVar, outsideSock]) {
      if (p && process.platform !== "win32" && existsSync(p)) {
        try {
          unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("removes a stale socket rebuilt under var/ (allow)", () => {
    if (process.platform === "win32") return;
    mkdirSync(varDir, { recursive: true });
    writeFileSync(staleUnderVar, "");
    expect(existsSync(staleUnderVar)).toBe(true);

    removeStaleUnixIpcSocket(staleUnderVar);
    expect(existsSync(staleUnderVar)).toBe(false);
  });

  it("does not touch a .sock file outside var/ (deny)", () => {
    if (process.platform === "win32") return;
    outsideDir = mkdtempSync(join(tmpdir(), "makamujo-ipc-outside-"));
    outsideSock = join(outsideDir, "evil.sock");
    writeFileSync(outsideSock, "keep");
    expect(existsSync(outsideSock)).toBe(true);

    removeStaleUnixIpcSocket(outsideSock);
    expect(existsSync(outsideSock)).toBe(true);
    expect(existsSync(join(varDir, "evil.sock"))).toBe(false);
  });

  it("rejects createReceiverWithPath for paths whose basename escapes policy", () => {
    expect(() => createReceiverWithPath(join(varDir, "..", "passwd"))).toThrow(
      /Unsafe IPC path/,
    );
  });

  it("accepts createReceiverWithPath for a var/*.sock path (missing file is ok)", async () => {
    if (process.platform === "win32") {
      const pipe = `\\\\.\\pipe\\makamujo-path-containment-${Date.now().toString(36)}`;
      const receive = createReceiverWithPath(pipe);
      await expect(receive(() => ({ name: "noop" }))).resolves.toBeUndefined();
      return;
    }
    const sock = join(
      varDir,
      `path-containment-recv-${Date.now().toString(36)}.sock`,
    );
    if (existsSync(sock)) unlinkSync(sock);
    const receive = createReceiverWithPath(sock);
    await expect(receive(() => ({ name: "noop" }))).resolves.toBeUndefined();
    removeStaleUnixIpcSocket(sock);
  });
});

describe("resolveExecutablePath missing allowlisted segment", () => {
  it("does not return a path that fails the rootPrefix startsWith check", () => {
    // Sibling of an allowlisted root must not match `${root}${sep}` prefix.
    const execDir = dirname(process.execPath);
    const sibling = `${execDir}-not-a-child${sep}chrome`;
    expect(resolve(sibling).startsWith(`${resolve(execDir)}${sep}`)).toBe(
      false,
    );
    expect(resolveExecutablePath(sibling)).toBeUndefined();
  });
});
