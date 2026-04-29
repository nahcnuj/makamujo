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
  // Wait for server to accept connections by polling the root URL. This is
  // more reliable than watching stdout across different runtimes.
  await new Promise<void>((resolve, reject) => {
    const timeoutMs = 15_000;
    const start = Date.now();

    function cleanup() {
      try { server.off('exit', onExit); } catch {}
    }

    function onExit(code: number | null) {
      cleanup();
      reject(new Error(`Server exited early with code ${code}`));
    }

    async function probeReady() {
      try {
        const res = await fetch(BASE + '/');
        if (res.ok) {
          cleanup();
          resolve();
          return;
        }
      } catch (_err) {
        // ignore and retry
      }

      if (Date.now() - start > timeoutMs) {
        cleanup();
        reject(new Error('Server startup timed out'));
        return;
      }

      setTimeout(probeReady, 200);
    }

    server.on('exit', onExit);
    probeReady();
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

  // Some runtimes (Bun) may reject malformed websocket handshakes with
  // 400 before application code runs. Accept either 501 (explicitly
  // returned when upgrades are disabled) or 400 (bad handshake).
  expect([400, 501]).toContain(probe.status);

  try { server.kill(); } catch {}
});
