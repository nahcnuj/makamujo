import { test, expect } from "bun:test";
import { spawn } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";

// We wait for the server readiness message on stdout rather than
// modifying runner timeouts so the test is robust on CI.

test("returns 501 when websocket upgrade unavailable", async () => {
  const port = 7788;
  const BASE = `http://127.0.0.1:${port}`;

  if (!existsSync("./var/cookieclicker.txt")) {
    try { mkdirSync("./var", { recursive: true }); } catch {}
    writeFileSync("./var/cookieclicker.txt", "");
  }

  const ipcPath = process.platform === "win32"
    ? `\\\\.\\pipe\\makamujo-test-ipc-7788`
    : `./var/ipc-test-7788.sock`;

  const server = spawn(process.platform === "win32" ? "bun.exe" : "bun", ["index.ts", "--port", String(port)], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      CONSOLE_LOOPBACK_ONLY: '1',
      FORCE_DISABLE_WS_UPGRADE: '1',
      MAKAMUJO_IPC_PATH: ipcPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Wait for server stdout to indicate readiness instead of polling HTTP.
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Server startup timed out'));
    }, 15_000);

    let buffer = '';
    const stdout = server.stdout;
    const stderr = server.stderr;

    function onData(chunk: any) {
      buffer += String(chunk);
      if (buffer.includes('Server running') || buffer.includes('🚀 Server running')) {
        clearTimeout(timeout);
        cleanup();
        resolve();
      }
    }

    function onExit(code: number | null) {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(`Server exited early with code ${code}`));
    }

    function cleanup() {
      try { stdout?.off('data', onData); } catch {}
      try { stderr?.off('data', onData); } catch {}
      try { server.off('exit', onExit); } catch {}
    }

    try {
      stdout?.on('data', onData);
      stderr?.on('data', onData);
      server.on('exit', onExit);
    } catch (err) {
      clearTimeout(timeout);
      cleanup();
      reject(err);
    }
  });

  const probe = await fetch(`${BASE}/console/api/ws`, {
    method: 'GET',
    headers: {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': 'probe',
      'Sec-WebSocket-Version': '13',
    },
  });

  expect(probe.status).toBe(501);

  try { server.kill(); } catch {}
});
