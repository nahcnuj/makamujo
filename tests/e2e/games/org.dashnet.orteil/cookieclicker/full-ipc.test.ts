import { test, expect } from "@playwright/test";
import { spawn } from "child_process";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, createWriteStream } from "fs";
import { join } from "path";

const PORT = 17779;
const SERVER_STARTUP_TIMEOUT_MS = 15_000;
const IDLE_STATE_TIMEOUT_MS = 90_000;

test.describe("Full IPC operation", () => {
  test("transitions from initialize state to idle state", async () => {
    test.setTimeout(120_000);

    const randomId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const ipcPath = process.platform === "win32"
      ? `\\\\.\\pipe\\makamujo-ipc-full-${randomId}`
      : join(process.cwd(), "var", `full-ipc-${randomId}.sock`);

    if (process.platform !== "win32" && existsSync(ipcPath)) {
      unlinkSync(ipcPath);
    }

    // The server requires this file to exist to read the initial game save data.
    if (!existsSync("./var/cookieclicker.txt")) {
      writeFileSync("./var/cookieclicker.txt", "");
    }

    let serverProcess: ReturnType<typeof spawn> | null = null;
    let browserProcess: ReturnType<typeof spawn> | null = null;

    try {
      // 1. Start `bun start`
      serverProcess = spawn(
        process.platform === "win32" ? "bun.exe" : "bun",
        ["start", "--port", String(PORT)],
        {
          env: {
            ...process.env,
            NODE_ENV: "production",
            MAKAMUJO_IPC_PATH: ipcPath,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      // Wait for the server to be ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Server startup timed out")),
          SERVER_STARTUP_TIMEOUT_MS,
        );

        let buffer = "";

        if (!serverProcess!.stdout || !serverProcess!.stderr) {
          clearTimeout(timeout);
          reject(new Error("Server stdout/stderr stream not available"));
          return;
        }

        serverProcess!.stdout.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          if (buffer.includes("Server running")) {
            clearTimeout(timeout);
            resolve();
          }
        });

        serverProcess!.on("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Server exited early with code ${code}`));
        });
      });

      // 2. Start `bun ./bin/x/browser.ts`
      browserProcess = spawn(
        process.platform === "win32" ? "bun.exe" : "bun",
        ["./bin/x/browser.ts", "--timeout", String(IDLE_STATE_TIMEOUT_MS)],
        {
          env: {
            ...process.env,
            MAKAMUJO_IPC_PATH: ipcPath,
            CHROMIUM_HEADLESS: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      // capture browser logs for debugging
      try { mkdirSync('./var/test-logs', { recursive: true }); } catch {}
      const ts = Date.now();
      const browserOutPath = `./var/test-logs/full-ipc-browser-${ts}.log`;
      const browserErrPath = `./var/test-logs/full-ipc-browser-${ts}.err.log`;
      const browserOutStream = createWriteStream(browserOutPath);
      const browserErrStream = createWriteStream(browserErrPath);
      browserProcess.stdout?.pipe(browserOutStream);
      browserProcess.stderr?.pipe(browserErrStream);

      // 3. Monitor server stdout for the first 'noop' action.
      //    The solver emits `[DEBUG] next action {"name":"noop"}` when it
      //    transitions from the 'initialize' game-state to the 'idle' game-state.
      const idleReached = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), IDLE_STATE_TIMEOUT_MS);

        if (!serverProcess!.stdout || !serverProcess!.stderr) {
          clearTimeout(timeout);
          resolve(false);
          return;
        }

        let buffer = "";
        const checkOutput = (chunk: Buffer) => {
          buffer += chunk.toString();
          if (buffer.includes('"name":"noop"')) {
            clearTimeout(timeout);
            resolve(true);
          }
        };

        serverProcess!.stdout.on("data", checkOutput);
        serverProcess!.stderr.on("data", checkOutput);

        serverProcess!.on("exit", () => {
          clearTimeout(timeout);
          resolve(false);
        });
      });

      expect(idleReached, "solver should transition from initialize to idle state via IPC").toBe(true);
    } finally {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill();
      }
      if (browserProcess && !browserProcess.killed) {
        browserProcess.kill();
      }
      if (process.platform !== "win32" && existsSync(ipcPath)) {
        unlinkSync(ipcPath);
      }
    }
  });
});
