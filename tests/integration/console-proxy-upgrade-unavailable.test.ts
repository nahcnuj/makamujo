import { test, expect } from "bun:test";
import { spawn } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";

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

  const start = Date.now();
  let lastErr: Error | null = null;
  while (Date.now() - start < 15_000) {
    try {
      const res = await fetch(`${BASE}/console/robots.txt`);
      if (res.ok) { lastErr = null; break; }
      lastErr = new Error(`unexpected status ${res.status}`);
    } catch (err) {
      lastErr = err as Error;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (lastErr) {
    try { server.kill(); } catch {}
    throw new Error(`server not responding: ${String(lastErr)}`);
  }

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
