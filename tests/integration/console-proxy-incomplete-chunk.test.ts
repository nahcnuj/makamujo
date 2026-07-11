import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "node:child_process";
import {
  allocateFreePort,
  killProcessTree,
  makamujoIpcPath,
  waitForPortRelease,
  waitForSpawnedReady,
  type SpawnedServer,
} from "../helpers/integrationServer";

let upstream: SpawnedServer | null = null;
let server: SpawnedServer | null = null;
let consoleBaseUrl: string | undefined;
let mainServerPort = 0;

beforeAll(async () => {
  const upstreamPort = await allocateFreePort();
  mainServerPort = await allocateFreePort();

  upstream = spawn("bun", ["tests/helpers/mock-upstream-server.ts"], {
    env: { ...process.env, PORT: String(upstreamPort) },
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as SpawnedServer;

  await waitForSpawnedReady(upstream, {
    label: "mock-upstream",
    readyPatterns: ["mock-upstream ready"],
    timeoutMs: 5_000,
  });

  server = spawn(
    process.platform === "win32" ? "bun.exe" : "bun",
    ["index.ts", "--port", String(mainServerPort)],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        CONSOLE_LOOPBACK_ONLY: "1",
        BROADCASTING_HOST: "127.0.0.1",
        BROADCASTING_PORT: String(upstreamPort),
        MAKAMUJO_IPC_PATH: makamujoIpcPath(`incomplete-chunk-${mainServerPort}`),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ) as unknown as SpawnedServer;

  // Must wait for Console URL: this test hits the console proxy → mock upstream HELLO stream.
  const output = await waitForSpawnedReady(server, {
    label: "incomplete-chunk main server",
    readyPatterns: ["🚀 Console running at"],
    timeoutMs: 15_000,
  });

  const m = output.match(/🚀 Console running at (https?:\/\/[^\s]+)/);
  if (!m?.[1]) {
    throw new Error(`Console URL not found in server output:\n${output.slice(-1500)}`);
  }
  consoleBaseUrl = m[1];
});

afterAll(async () => {
  killProcessTree(server);
  killProcessTree(upstream);
  server = null;
  upstream = null;
  await waitForPortRelease(400);
});

const READ_TIMEOUT_MS = 8000;

test("proxy maintains SSE connection and reconnects when upstream drops", async () => {
  if (!consoleBaseUrl) throw new Error("consoleBaseUrl not set");
  const base = consoleBaseUrl;
  const res = await fetch(`${base}/console/api/ws`, { headers: { accept: "text/event-stream" } });
  expect(res.ok).toBeTruthy();
  const body: any = res.body;
  expect(body).toBeTruthy();
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let accumulated = "";
  const deadline = Date.now() + 20_000;

  const readWithTimeout = () =>
    Promise.race([
      reader.read() as Promise<{ done: boolean; value: Uint8Array | undefined }>,
      new Promise<{ done: true; value: undefined }>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), READ_TIMEOUT_MS),
      ),
    ]);

  try {
    while ((accumulated.match(/data: HELLO/g) ?? []).length < 2) {
      if (Date.now() > deadline) break;
      const { done, value } = await readWithTimeout();
      if (done) break;
      if (value) accumulated += decoder.decode(value);
    }
  } finally {
    try { reader.cancel(); } catch { /* ignore */ }
  }

  const helloCount = (accumulated.match(/data: HELLO/g) ?? []).length;
  expect(helloCount).toBeGreaterThanOrEqual(2);
  expect(accumulated).not.toContain("PARTIAL");
}, 30_000);
