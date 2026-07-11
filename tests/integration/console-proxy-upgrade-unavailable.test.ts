import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import {
  allocateFreePort,
  killProcessTree,
  makamujoIpcPath,
  waitForPortRelease,
  waitForSpawnedReady,
  type SpawnedServer,
} from "../helpers/integrationServer";

test("returns 501 when websocket upgrade unavailable", async () => {
  const port = await allocateFreePort();
  const BASE = `http://127.0.0.1:${port}`;

  if (!existsSync("./var/cookieclicker.txt")) {
    try { mkdirSync("./var", { recursive: true }); } catch { /* ignore */ }
    writeFileSync("./var/cookieclicker.txt", "");
  }

  const server = spawn(
    process.platform === "win32" ? "bun.exe" : "bun",
    ["index.ts", "--port", String(port)],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        CONSOLE_LOOPBACK_ONLY: "1",
        FORCE_DISABLE_WS_UPGRADE: "1",
        MAKAMUJO_IPC_PATH: makamujoIpcPath(`upgrade-unavailable-${port}`),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ) as unknown as SpawnedServer;

  try {
    await waitForSpawnedReady(server, {
      label: "upgrade-unavailable server",
      readyPatterns: ["Server running", "🚀 Server running"],
      timeoutMs: 15_000,
    });

    const probe = await fetch(`${BASE}/console/api/ws`, {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "probe",
        "Sec-WebSocket-Version": "13",
      },
    });

    expect(probe.status).toBe(501);
  } finally {
    killProcessTree(server);
    await waitForPortRelease(400);
  }
});
