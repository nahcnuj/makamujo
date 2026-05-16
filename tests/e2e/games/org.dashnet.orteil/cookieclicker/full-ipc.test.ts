import { test, expect } from "@playwright/test";
import { spawn } from "child_process";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, createWriteStream } from "fs";
import { createServer, createConnection, type Socket } from "node:net";
import { join } from "path";

type ProxyServer = {
  once(event: "error", listener: (err: Error) => void): void;
  listen(path: string, callback?: () => void): void;
  close(callback?: (err?: Error) => void): void;
};

const PORT = 17779;
const SERVER_STARTUP_TIMEOUT_MS = 15_000;
const IDLE_STATE_TIMEOUT_MS = 90_000;

test.describe("Full IPC operation", () => {
  test("transitions from initialize state to idle state", async () => {
    test.setTimeout(120_000);

    const randomId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const serverIpcPath = process.platform === "win32"
      ? `\\.\\pipe\\makamujo-ipc-full-backend-${randomId}`
      : join(process.cwd(), "var", `full-ipc-backend-${randomId}.sock`);
    const proxyIpcPath = process.platform === "win32"
      ? `\\.\\pipe\\makamujo-ipc-full-proxy-${randomId}`
      : join(process.cwd(), "var", `full-ipc-proxy-${randomId}.sock`);

    if (process.platform !== "win32") {
      if (existsSync(serverIpcPath)) {
        unlinkSync(serverIpcPath);
      }
      if (existsSync(proxyIpcPath)) {
        unlinkSync(proxyIpcPath);
      }
    }

    // The server requires this file to exist to read the initial game save data.
    if (!existsSync("./var/cookieclicker.txt")) {
      writeFileSync("./var/cookieclicker.txt", "");
    }

    let serverProcess: ReturnType<typeof spawn> | null = null;
    let browserProcess: ReturnType<typeof spawn> | null = null;
    let proxyServer: ProxyServer | null = null;
    const browserConnections = new Set<Socket>();
    const backendConnections = new Set<Socket>();

    const isNamedMessage = (value: unknown): value is { name: unknown } =>
      typeof value === "object" && value !== null && "name" in value;

    const createJsonMessageHandler = (handleMessage: (message: unknown) => void) => {
      let buffer = "";
      return (chunk: Buffer) => {
        buffer += chunk.toString();

        let depth = 0;
        let inString = false;
        let escaped = false;
        let startIndex = -1;

        for (let i = 0; i < buffer.length; i++) {
          const char = buffer[i];

          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (char === "\\") {
              escaped = true;
            } else if (char === '"') {
              inString = false;
            }
            continue;
          }

          if (char === '"') {
            inString = true;
            continue;
          }

          if (char === "{") {
            if (depth === 0) {
              startIndex = i;
            }
            depth += 1;
            continue;
          }

          if (char === "}") {
            depth -= 1;
            if (depth === 0 && startIndex !== -1) {
              const jsonText = buffer.slice(startIndex, i + 1);
              try {
                handleMessage(JSON.parse(jsonText));
              } catch {
                // Ignore incomplete or invalid JSON until the object is complete.
              }
              buffer = buffer.slice(i + 1);
              i = -1;
              startIndex = -1;
            }
          }
        }
      };
    };

    try {
      const proxyReady = new Promise<void>((resolve, reject) => {
        proxyServer = createServer((browserSocket) => {
          const backendSocket = createConnection(serverIpcPath);

          browserConnections.add(browserSocket);
          backendConnections.add(backendSocket);

          const handleBrowserMessage = createJsonMessageHandler((message) => {
            if (isNamedMessage(message) && typeof message.name === "string" && message.name === "idle") {
              sawBrowserIdle = true;
              maybeResolve();
            }
          });
          const handleServerMessage = createJsonMessageHandler((message) => {
            if (isNamedMessage(message) && typeof message.name === "string" && message.name === "noop") {
              sawServerNoop = true;
              maybeResolve();
            }
          });

          browserSocket.on("data", (chunk: Buffer) => {
            handleBrowserMessage(chunk);
            if (backendSocket.writable) {
              backendSocket.write(chunk);
            }
          });

          backendSocket.on("data", (chunk: Buffer) => {
            handleServerMessage(chunk);
            if (browserSocket.writable) {
              browserSocket.write(chunk);
            }
          });

          const cleanupConnection = () => {
            browserConnections.delete(browserSocket);
            backendConnections.delete(backendSocket);
            try { browserSocket.destroy(); } catch {}
            try { backendSocket.destroy(); } catch {}
          };

          browserSocket.on("error", cleanupConnection);
          backendSocket.on("error", cleanupConnection);
          browserSocket.on("close", cleanupConnection);
          backendSocket.on("close", cleanupConnection);
        });

        proxyServer.once("error", reject);
        proxyServer.listen(proxyIpcPath, () => resolve());
      });

      await proxyReady;

      // 1. Start `bun start`
      serverProcess = spawn(
        process.platform === "win32" ? "bun.exe" : "bun",
        ["index.ts", "--port", String(PORT)],
        {
          env: {
            ...process.env,
            NODE_ENV: "production",
            CONSOLE_LOOPBACK_ONLY: '1',
            MAKAMUJO_IPC_PATH: serverIpcPath,
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
            MAKAMUJO_IPC_PATH: proxyIpcPath,
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

      let sawServerNoop = false;
      let sawBrowserIdle = false;
      let resolveIdle: (() => void) | null = null;
      const idlePromise = new Promise<boolean>((resolve) => {
        resolveIdle = () => resolve(true);
      });

      const maybeResolve = () => {
        if (sawServerNoop && sawBrowserIdle && resolveIdle) {
          resolveIdle();
        }
      };

      const idleReached = await Promise.race([
        idlePromise,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), IDLE_STATE_TIMEOUT_MS)),
      ]).then((value) => value === true);

      expect(idleReached, "solver should transition from initialize to idle state via IPC").toBe(true);
    } finally {
      for (const socket of browserConnections) {
        try { socket.destroy(); } catch {}
      }
      for (const socket of backendConnections) {
        try { socket.destroy(); } catch {}
      }
      const closableProxyServer = proxyServer as { close(callback?: (err?: Error) => void): void } | null;
      try { closableProxyServer?.close(); } catch {}
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill();
      }
      if (browserProcess && !browserProcess.killed) {
        browserProcess.kill();
      }
      if (process.platform !== "win32") {
        if (existsSync(serverIpcPath)) {
          unlinkSync(serverIpcPath);
        }
        if (existsSync(proxyIpcPath)) {
          unlinkSync(proxyIpcPath);
        }
      }
    }
  });
});
