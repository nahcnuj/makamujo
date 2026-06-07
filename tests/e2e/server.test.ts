import { expect, test } from "@playwright/test";
import { spawn } from "child_process";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import net from "node:net";
import { createReceiverWithPath, createSenderWithPath } from "../../lib/Browser/socket";

let PORT = 0;
let BASE_URL = '';
const SERVER_STARTUP_TIMEOUT_MS = 30_000;

let server: ReturnType<typeof spawn> | null = null;

const waitForServerReady = async () => {
  return new Promise<void>((resolve, reject) => {
    if (!server) {
      reject(new Error("Server process not started"));
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error("Server startup timed out"));
    }, SERVER_STARTUP_TIMEOUT_MS);

    let buffer = "";
    if (!server.stdout || !server.stderr) {
      reject(new Error('Server stdout/stderr stream not available'));
      return;
    }

    server.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes("Server running")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    server.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server process exited early with code ${code}`));
    });

    server.stderr.on("data", (chunk) => {
      // optionally log server stderr for diagnosis
      // console.error("server stderr:", chunk.toString());
    });
  });
};

test.beforeAll(async () => {
  if (!existsSync("./var/cookieclicker.txt")) {
    writeFileSync("./var/cookieclicker.txt", "");
  }
  PORT = await new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close(() => reject(new Error('failed to acquire a free port')));
        return;
      }
      const port = address.port;
      probe.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
        } else {
          resolve(port);
        }
      });
    });
  });
  BASE_URL = `http://127.0.0.1:${PORT}`;
  // Use a unique IPC path per server run to avoid conflicts on Windows.
  const randomId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const ipcPath = process.platform === "win32"
    ? `\\\\.\\pipe\\makamujo-ipc-${randomId}`
    : join(process.cwd(), "var", `ipc-${randomId}.sock`);

  const bunExecutable = (() => {
    if (process.env.BUN) return process.env.BUN;
    if (process.env.BUN_EXECUTABLE) return process.env.BUN_EXECUTABLE;
    if (process.platform === "win32") return "bun.exe";
    
    // On non-Windows, try the home directory path first if it exists
    const home = process.env.HOME;
    if (home) {
      const homeBun = join(home, ".bun", "bin", "bun");
      if (existsSync(homeBun)) return homeBun;
    }
    // Fall back to "bun" on PATH
    return "bun";
  })();

  server = spawn(bunExecutable, ["index.ts", "--port", String(PORT)], {
    env: { ...process.env, NODE_ENV: "production", CONSOLE_LOOPBACK_ONLY: '1', MAKAMUJO_IPC_PATH: ipcPath },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForServerReady();
});

test.afterAll(() => {
  if (server && !server.killed) {
    server.kill();
  }
  server = null;
});

test.describe("server", () => {
  test("serves the frontend HTML", async ({ request }) => {
    // Retry the GET a few times to avoid transient CI timing issues.
    let res = null as any;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        res = await request.get(BASE_URL);
        if (res.ok()) break;
      } catch (_) {
        // ignore and retry
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(res && res.ok(), 'frontend HTML should respond OK').toBeTruthy();
    const html = await res.text();
    expect(html).toContain("<title>馬可無序");
    expect(html).toContain('<div id="root">');
    expect(html).toMatch(/<link\b[^>]*\bhref="\/favicon-32x32\.png"/);
  });

  test("responds to /api/speech", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/speech`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("speech");
    expect(typeof data.speech).toBe('string');
  });

  test("responds to /api/game", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/game`);
    expect(res.ok()).toBeTruthy();
  });

  test("responds to /api/meta", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/meta`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("nGram");
  });

  test("propagates replyTargetComment through /api/meta responses", async ({ request }) => {
    const postRes = await request.post(`${BASE_URL}/api/meta`, {
      data: {
        replyTargetComment: {
          text: 'わかりました。返信します',
          pickedTopic: '返信',
        },
      },
    });
    expect(postRes.ok()).toBeTruthy();

    const metaRes = await request.get(`${BASE_URL}/api/meta`);
    expect(metaRes.ok()).toBeTruthy();
    const metaJson = await metaRes.json();
    expect(metaJson).toHaveProperty('replyTargetComment');
    expect(metaJson.replyTargetComment).toEqual({
      text: 'わかりました。返信します',
      pickedTopic: '返信',
    });
  });

  test("accepts POST /api/meta", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/meta`, {
      data: { data: { type: 'niconama', data: { isLive: false, title: 'test', startTime: 0, total: 0, points: { gift: 0, ad: 0 }, url: 'https://example.com' } } },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("normalizes legacy /api/meta payload and preserves missing comments count", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/meta`, {
      data: {
        type: 'niconama',
        data: {
          isLive: true,
          title: 'legacy normalization',
          startTime: 0,
          total: 1,
          points: { gift: 0, ad: 0 },
          url: 'https://example.com/legacy',
        },
      },
    });

    expect(res.ok()).toBeTruthy();

    const metaRes = await request.get(`${BASE_URL}/api/meta`);
    expect(metaRes.ok()).toBeTruthy();
    const metaJson = await metaRes.json();
    expect(metaJson).toHaveProperty('niconama.type', 'live');
    expect(metaJson).toHaveProperty('niconama.meta.url', 'https://example.com/legacy');
    expect(metaJson.niconama.meta.total).not.toHaveProperty('comments');
  });

  test("preserves nested replyTargetComment in wrapped legacy payloads", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/meta`, {
      data: {
        data: {
          type: 'niconama',
          data: {
            isLive: true,
            title: 'legacy wrapped reply target',
            startTime: 0,
            total: 0,
            points: { gift: 0, ad: 0 },
            url: 'https://example.com/wrapped',
          },
          replyTargetComment: {
            text: 'legacy wrapper reply target',
            pickedTopic: '返信',
          },
        },
      },
    });

    expect(res.ok()).toBeTruthy();

    const metaRes = await request.get(`${BASE_URL}/api/meta`);
    expect(metaRes.ok()).toBeTruthy();
    const metaJson = await metaRes.json();
    expect(metaJson).toHaveProperty('replyTargetComment');
    expect(metaJson.replyTargetComment).toEqual({
      text: 'legacy wrapper reply target',
      pickedTopic: '返信',
    });
  });

  test("preserves replyTargetComment when normalizing legacy /api/meta payload", async ({ request }) => {
    const legacyRes = await request.post(`${BASE_URL}/api/meta`, {
      data: {
        type: 'niconama',
        data: {
          isLive: true,
          title: 'legacy reply target',
          startTime: 0,
          total: 1,
          points: { gift: 0, ad: 0 },
          url: 'https://example.com/legacy-reply',
        },
        replyTargetComment: {
          text: 'Legacy 返信先コメント',
          pickedTopic: '返信',
        },
      },
    });
    expect(legacyRes.ok()).toBeTruthy();

    const metaRes = await request.get(`${BASE_URL}/api/meta`);
    expect(metaRes.ok()).toBeTruthy();
    const metaJson = await metaRes.json();
    expect(metaJson).toHaveProperty('replyTargetComment');
    expect(metaJson.replyTargetComment).toEqual({
      text: 'Legacy 返信先コメント',
      pickedTopic: '返信',
    });
  });

  test("rejects root POST / after external comment routes are removed", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/`, { data: {} });
    expect(res.status()).toBe(404);
  });

  test("rejects root PUT / after external comment routes are removed", async ({ request }) => {
    const res = await request.put(`${BASE_URL}/`, {
      data: [{ data: { comment: 'hello', no: 1, anonymity: false, hasGift: false } }],
    });
    expect(res.status()).toBe(404);
  });

  test("serves /nc433974.png", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/nc433974.png`);
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('image/png');
  });

  test("serves /favicon-32x32.png", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/favicon-32x32.png`);
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('image/png');
  });

  test("connects browser IPC to stream server and publishes /api/meta", async ({ request }) => {
    const randomId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const ipcPath = process.platform === "win32"
      ? `\\\\.\\pipe\\makamujo-ipc-${randomId}`
      : join(process.cwd(), "var", `ipc-test-${randomId}.sock`);

    if (!process.platform.startsWith("win") && existsSync(ipcPath)) {
      unlinkSync(ipcPath);
    }

    let receivedState: unknown = null;
    const receiver = createReceiverWithPath(ipcPath);
    receiver((state) => {
      receivedState = state;
      // Mirror stream status into the running server via /api/meta (fire and forget)
      void request.post(`${BASE_URL}/api/meta`, {
        data: {
          type: 'niconama',
          data: {
            isLive: true,
            title: 'IPC integration test',
            startTime: 0,
            total: 0,
            points: { gift: 0, ad: 0 },
            url: (state as any)?.url ?? 'https://example.com',
          },
        },
      }).catch(() => undefined);
      return { name: 'noop' };
    });

    const senderFn = createSenderWithPath(ipcPath);
    const sender = await senderFn(async () => {
      // noop receiving from browser-side action
    });

    sender({ name: 'idle', url: 'https://example.com', state: { foo: 'bar' } });
    await new Promise((r) => setTimeout(r, 400));

    expect(receivedState).toEqual({ name: 'idle', url: 'https://example.com', state: { foo: 'bar' } });

    const metaRes = await request.get(`${BASE_URL}/api/meta`);
    expect(metaRes.ok()).toBeTruthy();

    const metaJson = await metaRes.json();
    expect(metaJson).toHaveProperty('niconama');

    // agent.getStreamState returns { type:'live', meta:{...} }
    expect(metaJson.niconama).toHaveProperty('type', 'live');
    expect(metaJson.niconama).toHaveProperty('meta.title', 'IPC integration test');

    if (!process.platform.startsWith("win") && existsSync(ipcPath)) {
      unlinkSync(ipcPath);
    }
  });

  test("renders the app in a browser", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    expect(await page.title()).toContain("馬可無序");
    const rootElement = await page.$("#root");
    expect(rootElement).not.toBeNull();
  });
});
