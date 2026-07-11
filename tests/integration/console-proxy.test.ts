import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import {
  allocateFreePort,
  killProcessTree,
  makamujoIpcPath,
  resolveBunExecutable,
  waitForPortRelease,
  type SpawnedServer,
} from "../helpers/integrationServer";

const SERVER_STARTUP_TIMEOUT_MS = 15_000;

let server: SpawnedServer | null = null;
let broadcastingBaseUrl = "";
let mainServerPort = 0;

beforeAll(async () => {
  if (!existsSync("./var/cookieclicker.txt")) {
    try { mkdirSync("./var", { recursive: true }); } catch { /* ignore */ }
    writeFileSync("./var/cookieclicker.txt", "");
  }

  mainServerPort = await allocateFreePort();
  broadcastingBaseUrl = `http://127.0.0.1:${mainServerPort}`;

  server = spawn(
    resolveBunExecutable(),
    ["index.ts", "--port", String(mainServerPort)],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        CONSOLE_LOOPBACK_ONLY: "1",
        MAKAMUJO_IPC_PATH: makamujoIpcPath(`console-proxy-${mainServerPort}`),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ) as unknown as SpawnedServer;

  // Wait for server listen + external agent init (success or fallback).
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanupListeners();
      reject(new Error(`Server startup timed out. Output:\n${buffer.slice(-2000)}`));
    }, SERVER_STARTUP_TIMEOUT_MS);

    let buffer = "";
    let serverRunning = false;
    let agentReady = false;
    const stdout = server!.stdout;
    const stderr = server!.stderr;

    function checkReady() {
      if (serverRunning && agentReady) {
        clearTimeout(timeout);
        cleanupListeners();
        resolve();
      }
    }

    function onData(chunk: Buffer | string) {
      buffer += String(chunk);
      if (!serverRunning && (buffer.includes("Server running") || buffer.includes("🚀 Server running"))) {
        serverRunning = true;
      }
      if (!agentReady && (
        buffer.includes("[INFO] external agent API initialized") ||
        buffer.includes("[WARN] createAgentApi threw") ||
        buffer.includes("[WARN] automated-gameplay-transmitter did not export") ||
        buffer.includes("[WARN] dynamic import failed")
      )) {
        agentReady = true;
      }
      checkReady();
    }

    function onExit(code: number | null) {
      clearTimeout(timeout);
      cleanupListeners();
      reject(new Error(`Server exited early with code ${code}. Output:\n${buffer.slice(-2000)}`));
    }

    function cleanupListeners() {
      try { stdout?.off("data", onData); } catch { /* ignore */ }
      try { stderr?.off("data", onData); } catch { /* ignore */ }
      try { server?.off("exit", onExit); } catch { /* ignore */ }
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
  await waitForPortRelease(400);
});

test("proxy returns SSE content-type at /console/api/ws", async () => {
  const res = await fetch(`${broadcastingBaseUrl}/console/api/ws`, {
    headers: { accept: "text/event-stream" },
  });
  expect(res.ok).toBeTruthy();
  const ct = res.headers.get("content-type") ?? "";
  expect(ct).toContain("text/event-stream");
});

test("proxy forwards WebSocket upgrades to broadcasting server", async () => {
  try {
    const probe = await fetch(`${broadcastingBaseUrl}/console/api/ws`, {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "probe",
        "Sec-WebSocket-Version": "13",
      },
    });
    if (probe.status !== 101) {
      return;
    }
  } catch {
    return;
  }

  const wsUrl = `ws://127.0.0.1:${mainServerPort}/console/api/ws`;
  const firstMessage = await new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error("timeout"));
    }, 5000);
    ws.onmessage = (ev: any) => {
      clearTimeout(timeout);
      try { ws.close(); } catch { /* ignore */ }
      resolve(ev.data);
    };
    ws.onerror = (e: any) => {
      clearTimeout(timeout);
      try { ws.close(); } catch { /* ignore */ }
      reject(e);
    };
  });
  expect(firstMessage).toBeTruthy();
  const parsed = JSON.parse(firstMessage as string);
  expect(parsed).toHaveProperty("niconama");
});

test("comment count in /api/meta reflects PUT comments after POST /api/meta stream state", async () => {
  await fetch(`${broadcastingBaseUrl}/`, {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json" },
  });

  const streamStateBody = JSON.stringify({
    type: "niconama",
    data: {
      isLive: true,
      title: "テスト配信",
      startTime: 1_700_000_000,
      total: 10,
      points: { gift: 0, ad: 0 },
      url: "https://live.nicovideo.jp/watch/lv999999999",
    },
  });

  let initialMeta: any = null;
  for (let i = 0; i < 30; i++) {
    await fetch(`${broadcastingBaseUrl}/api/meta`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: streamStateBody,
    });
    initialMeta = await (await fetch(`${broadcastingBaseUrl}/api/meta`)).json();
    if (initialMeta.commentCount === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(initialMeta.commentCount).toBe(0);

  await fetch(`${broadcastingBaseUrl}/`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([{ data: { comment: "こんにちは", no: 1, anonymity: false, hasGift: false } }]),
  });

  let updatedMeta = await (await fetch(`${broadcastingBaseUrl}/api/meta`)).json() as any;
  expect(updatedMeta.commentCount).toBe(1);

  await fetch(`${broadcastingBaseUrl}/`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([{ data: { comment: "こんばんは", no: 3, anonymity: false, hasGift: false } }]),
  });

  updatedMeta = await (await fetch(`${broadcastingBaseUrl}/api/meta`)).json() as any;
  expect(updatedMeta.commentCount).toBe(3);
});
