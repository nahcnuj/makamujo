import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import {
  allocateFreePort,
  killProcessTree,
  makamujoIpcPath,
  resolveBunExecutable,
  type SpawnedServer,
  waitForPortRelease,
} from "../helpers/integrationServer";

const SERVER_STARTUP_TIMEOUT_MS = 15_000;

let server: SpawnedServer | null = null;
let broadcastingBaseUrl = "";

beforeAll(async () => {
  // The file only marks that the game exists; write it unconditionally so the
  // setup never depends on a check-then-write race (CodeQL js/file-system-race
  // flags the old `existsSync` + `writeFileSync` pattern).
  try {
    mkdirSync("./var", { recursive: true });
  } catch {
    /* ignore */
  }
  writeFileSync("./var/cookieclicker.txt", "");
  // The liveness state is kept in var/ and would otherwise survive into the
  // next run.
  try {
    rmSync("./var/overlay-liveness-state.json", { force: true });
  } catch {
    /* ignore */
  }

  const port = await allocateFreePort();
  broadcastingBaseUrl = `http://127.0.0.1:${port}`;

  server = spawn(resolveBunExecutable(), ["index.ts", "--port", String(port)], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      CONSOLE_LOOPBACK_ONLY: "1",
      NICONAMA_WATCH_PAGE_DISABLED: "1",
      MAKAMUJO_IPC_PATH: makamujoIpcPath(`overlay-beacon-${port}`),
    },
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as SpawnedServer;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanupListeners();
      reject(
        new Error(`Server startup timed out. Output:\n${buffer.slice(-2000)}`),
      );
    }, SERVER_STARTUP_TIMEOUT_MS);

    let buffer = "";
    let serverRunning = false;
    const stdout = server?.stdout;
    const stderr = server?.stderr;

    function checkReady() {
      if (serverRunning) {
        clearTimeout(timeout);
        cleanupListeners();
        resolve();
      }
    }

    function onData(chunk: Buffer | string) {
      buffer += String(chunk);
      if (
        !serverRunning &&
        (buffer.includes("Server running") ||
          buffer.includes("🚀 Server running"))
      ) {
        serverRunning = true;
      }
      checkReady();
    }

    function onExit(code: number | null) {
      clearTimeout(timeout);
      cleanupListeners();
      reject(
        new Error(
          `Server exited early with code ${code}. Output:\n${buffer.slice(-2000)}`,
        ),
      );
    }

    function cleanupListeners() {
      try {
        stdout?.off("data", onData);
      } catch {
        /* ignore */
      }
      try {
        stderr?.off("data", onData);
      } catch {
        /* ignore */
      }
      try {
        server?.off("exit", onExit);
      } catch {
        /* ignore */
      }
    }

    try {
      stdout?.on("data", onData);
      stderr?.on("data", onData);
      server?.on("exit", onExit);
    } catch (err) {
      clearTimeout(timeout);
      cleanupListeners();
      reject(err);
    }
  });
});

afterAll(async () => {
  killProcessTree(server);
  server = null;
  try {
    rmSync("./var/overlay-liveness-state.json", { force: true });
  } catch {
    /* ignore */
  }
  await waitForPortRelease(400);
});

test("the overlay page can report itself to the server", async () => {
  const res = await fetch(`${broadcastingBaseUrl}/api/overlay-beacon`);
  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");
});

test("the served overlay page reports itself", async () => {
  // The page is built into a bundle; the beacon path has to be part of it, or
  // the server would never hear from the overlay.
  const res = await fetch(`${broadcastingBaseUrl}/frontend.js`);
  expect(res.ok).toBeTruthy();
  const bundle = await res.text();
  expect(bundle).toContain("/api/overlay-beacon");
});
