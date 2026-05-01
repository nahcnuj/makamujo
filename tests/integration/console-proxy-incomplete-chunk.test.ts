import { test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'child_process';

const BROADCASTING_UPSTREAM_PORT = 8888;
const MAIN_SERVER_PORT = 7777;

let upstream: ReturnType<typeof spawn> | null = null;
let server: ReturnType<typeof spawn> | null = null;
let consoleBaseUrl: string | undefined = undefined;

beforeAll(async () => {
  upstream = spawn('bun', ['tests/helpers/mock-upstream-server.ts'], {
    env: { ...process.env, PORT: String(BROADCASTING_UPSTREAM_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('upstream start timeout')), 5000);
    let buf = '';
    upstream!.stdout!.on('data', (c: any) => {
      buf += String(c);
      if (buf.includes('mock-upstream ready')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    upstream!.on('exit', (code) => { clearTimeout(timeout); reject(new Error('upstream exited ' + code)); });
  });

  server = spawn('bun', ['index.ts', '--port', String(MAIN_SERVER_PORT)], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CONSOLE_LOOPBACK_ONLY: '1',
      BROADCASTING_HOST: '127.0.0.1',
      BROADCASTING_PORT: String(BROADCASTING_UPSTREAM_PORT),
      MAKAMUJO_IPC_PATH: process.platform === 'win32' ? `\\.\\pipe\\makamujo-test-ipc` : `./var/ipc-test.sock`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server start timeout')), 15000);
    let buf = '';
    server!.stdout!.on('data', (c: any) => {
      const s = String(c);
      buf += s;
      // The main process logs both server and console URLs; prefer the console URL.
      const m = buf.match(/🚀 Console running at (https?:\/\/[^\s]+)/);
      if (m) {
        consoleBaseUrl = m[1];
        clearTimeout(timeout);
        resolve();
        return;
      }
      if (buf.includes('Server running') || buf.includes('🚀 Server running')) {
        // Fallback: server started but console URL not yet printed. Keep listening.
      }
    });
    server!.on('exit', (code) => { clearTimeout(timeout); reject(new Error('server exited ' + code)); });
  });
});

afterAll(() => {
  if (server && !server.killed) server.kill();
  if (upstream && !upstream.killed) upstream.kill();
  server = null;
  upstream = null;
});

const READ_TIMEOUT_MS = 4000;

test('proxy maintains SSE connection and reconnects when upstream drops', async () => {
  const base = consoleBaseUrl ?? `http://127.0.0.1:${MAIN_SERVER_PORT}`;
  const res = await fetch(`${base}/console/api/ws`, { headers: { accept: 'text/event-stream' } });
  expect(res.ok).toBeTruthy();
  const body: any = res.body;
  expect(body).toBeTruthy();
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let accumulated = '';

  // Read chunks with a per-read timeout to avoid hanging indefinitely.
  const readWithTimeout = () =>
    Promise.race([
      reader.read() as Promise<{ done: boolean; value: Uint8Array | undefined }>,
      new Promise<{ done: true; value: undefined }>(r => setTimeout(() => r({ done: true, value: undefined }), READ_TIMEOUT_MS)),
    ]);

  try {
    // Keep reading until we see at least 2 HELLO events (initial + after reconnect)
    while ((accumulated.match(/data: HELLO/g) ?? []).length < 2) {
      const { done, value } = await readWithTimeout();
      if (done) break;
      if (value) accumulated += decoder.decode(value);
    }
  } finally {
    try { reader.cancel(); } catch {}
  }

  // The proxy should keep the downstream connection alive and deliver at least
  // two HELLO events: one from the initial connection and one after reconnect.
  const helloCount = (accumulated.match(/data: HELLO/g) ?? []).length;
  expect(helloCount).toBeGreaterThanOrEqual(2);
});
