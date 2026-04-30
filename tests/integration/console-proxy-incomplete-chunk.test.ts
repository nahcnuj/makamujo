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

test('proxy forwards initial SSE event despite upstream truncation', async () => {
  const base = consoleBaseUrl ?? `http://127.0.0.1:${MAIN_SERVER_PORT}`;
  const res = await fetch(`${base}/console/api/ws`, { headers: { accept: 'text/event-stream' } });
  expect(res.ok).toBeTruthy();
  const body: any = res.body;
  expect(body).toBeTruthy();
  const reader = body.getReader();
  const { done, value } = await reader.read();
  const decoder = new TextDecoder();
  const text = decoder.decode(value);
  // We expect to receive the initial well-formed event
  expect(text).toContain('data: HELLO');
  // Ensure stream eventually ends (upstream closed abruptly)
  const next = await reader.read();
  expect(next.done).toBeTruthy();
});
