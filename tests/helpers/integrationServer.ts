import { spawn } from "node:child_process";
import { createServer } from "node:net";

/** stdout/stderr pipe child (stdin ignored). */
export type SpawnedServer = {
  pid?: number;
  killed: boolean;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on: (event: string, listener: (...args: any[]) => void) => any;
  off: (event: string, listener: (...args: any[]) => void) => any;
};

/** Allocate an unused TCP port on 127.0.0.1 (avoids fixed-port collisions across suites). */
export const allocateFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("failed to allocate free port"));
        return;
      }
      const { port } = addr;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });

/**
 * Kill a process and its children. On Windows, `proc.kill()` alone often leaves
 * Bun/console children holding ports and named pipes.
 */
export const killProcessTree = (proc: SpawnedServer | null | undefined): void => {
  if (!proc) return;
  const pid = proc.pid;
  if (pid === undefined) {
    try { proc.kill(); } catch { /* ignore */ }
    return;
  }
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      try { proc.kill(); } catch { /* ignore */ }
    }
  } else {
    try { proc.kill("SIGTERM"); } catch { /* ignore */ }
  }
};

/** Brief pause so OS can release TCP ports / named pipes after kill. */
export const waitForPortRelease = (ms = 300): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type WaitForServerReadyOptions = {
  timeoutMs?: number;
  /** Substrings that mean the process is ready (any one match is enough unless requireAll). */
  readyPatterns: string[];
  requireAll?: boolean;
  label?: string;
};

/**
 * Wait until stdout/stderr contains ready markers, or reject on early exit.
 */
export const waitForSpawnedReady = (
  proc: SpawnedServer,
  options: WaitForServerReadyOptions,
): Promise<string> => {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const label = options.label ?? "server";
  const requireAll = options.requireAll ?? false;

  return new Promise((resolve, reject) => {
    let buffer = "";
    const matched = new Set<string>();

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} startup timed out after ${timeoutMs}ms. Output:\n${buffer.slice(-2000)}`));
    }, timeoutMs);

    const check = () => {
      for (const pattern of options.readyPatterns) {
        if (buffer.includes(pattern)) matched.add(pattern);
      }
      const done = requireAll
        ? matched.size === options.readyPatterns.length
        : matched.size > 0;
      if (done) {
        cleanup();
        resolve(buffer);
      }
    };

    const onData = (chunk: Buffer | string) => {
      buffer += String(chunk);
      check();
    };

    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(
        `${label} exited early with code ${code}. Output:\n${buffer.slice(-2000)}`,
      ));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      try { proc.stdout.off("data", onData); } catch { /* ignore */ }
      try { proc.stderr.off("data", onData); } catch { /* ignore */ }
      try { proc.off("exit", onExit); } catch { /* ignore */ }
    };

    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", onExit);
    check();
  });
};

export const makamujoIpcPath = (suffix: string): string =>
  process.platform === "win32"
    ? `\\\\.\\pipe\\makamujo-test-ipc-${suffix}`
    : `./var/ipc-test-${suffix}.sock`;
