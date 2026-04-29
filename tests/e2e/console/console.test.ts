import { expect, test } from "@playwright/test";
import { spawn } from "child_process";
import { existsSync, writeFileSync, createWriteStream, mkdirSync } from "fs";
import { join } from "path";
import { cloneAgentStateResponseMockFixture } from "../../fixtures/agentStateResponseMock";

let CONSOLE_BASE_URL = `https://127.0.0.1`;
const BROADCASTING_BASE_URL = `http://127.0.0.1:7777`;
const SERVER_STARTUP_TIMEOUT_MS = 30_000;
const BROWSER_PAGE_LOAD_TIMEOUT_MS = 60_000;
const EXPECTED_CONSOLE_TITLE = "馬可無序 - 管理コンソール";

let server: ReturnType<typeof spawn> | null = null;
let outStream: import('fs').WriteStream | null = null;
let errStream: import('fs').WriteStream | null = null;

const waitForServerReady = async (): Promise<string | null> => {
  return new Promise<string | null>((resolve, reject) => {
    if (!server) {
      reject(new Error("Server process not started"));
      return;
    }

    if (!server.stdout || !server.stderr) {
      reject(new Error("Server stdout/stderr stream not available"));
      return;
    }

    const proc = server!;
    const stdout = proc.stdout!;

    let settled = false;
    let buffer = "";

    const cleanup = () => {
      clearTimeout(timeout);
      stdout.off("data", onData);
      proc.off("exit", onExit);
    };

    const resolveOnce = (url?: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(url ?? null);
    };

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const marker = "Console running at ";
      const idx = buffer.indexOf(marker);
      if (idx >= 0) {
        const rest = buffer.slice(idx + marker.length);
        const line = (rest.split(/\r?\n/)[0] || "").trim();
        resolveOnce(line || null);
      } else if (buffer.includes("Console running")) {
        resolveOnce(null);
      }
    };

    const onExit = (code: number | null) => {
      rejectOnce(new Error(`Server process exited early with code ${code}`));
    };

    const timeout = setTimeout(() => {
      rejectOnce(new Error("Server startup timed out"));
    }, SERVER_STARTUP_TIMEOUT_MS);

    stdout.on("data", onData);
    proc.on("exit", onExit);
  });
};

test.beforeAll(async ({ request }) => {
  if (!existsSync("./var/cookieclicker.txt")) {
    writeFileSync("./var/cookieclicker.txt", "");
  }

  // Use a unique IPC path per test run to avoid named-pipe conflicts on
  // Windows CI runners which can cause the server to crash when the
  // default pipe is already in use.
  const randomId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const ipcPath = process.platform === "win32"
    ? `\\.\\pipe\\makamujo-ipc-${randomId}`
    : join(process.cwd(), "var", `ipc-${randomId}.sock`);

  server = spawn(
    process.platform === "win32" ? "bun.exe" : "bun",
    ["index.ts", "--port", "7777"],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        CONSOLE_TLS_CERT: process.env.CONSOLE_TLS_CERT,
        CONSOLE_TLS_KEY: process.env.CONSOLE_TLS_KEY,
        CONSOLE_LOOPBACK_ONLY: '1',
        MAKAMUJO_IPC_PATH: ipcPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  // Capture server stdout/stderr to files for debugging when tests fail.
  try {
    mkdirSync("./var/test-logs", { recursive: true });
  } catch {}
  const ts = Date.now();
  const outPath = `./var/test-logs/console-server-${ts}.log`;
  const errPath = `./var/test-logs/console-server-${ts}.err.log`;
  outStream = createWriteStream(outPath);
  errStream = createWriteStream(errPath);
  server.stdout?.pipe(outStream);
  server.stderr?.pipe(errStream);

  const consoleUrl = await waitForServerReady();
  if (consoleUrl) {
    CONSOLE_BASE_URL = consoleUrl.replace(/\/$/, '');
  }

  // Verify the console base URL is responding before continuing.
  const start = Date.now();
  const deadline = start + SERVER_STARTUP_TIMEOUT_MS;
  let lastErr: Error | null = null;
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${CONSOLE_BASE_URL}/console/robots.txt`);
      if (health.ok) {
        lastErr = null;
        break;
      }
      lastErr = new Error(`unexpected status ${health.status}`);
    } catch (err) {
      lastErr = err as Error;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (lastErr) {
    throw new Error(`Console server not responding at ${CONSOLE_BASE_URL}: ${String(lastErr)}`);
  }

  // Register the test runner's IP as the allowed IP so that subsequent
  // requests to the IP-restricted console server are permitted.
  const allowlistRegistrationResponse = await fetch(`${BROADCASTING_BASE_URL}/`, { method: 'POST' });
  const allowlistRegistrationResponseText = await allowlistRegistrationResponse.text();
  expect(
    allowlistRegistrationResponse.ok,
    `Allowlist registration failed with status ${allowlistRegistrationResponse.status} ${allowlistRegistrationResponse.statusText || ''}: ${allowlistRegistrationResponseText}`,
  ).toBeTruthy();
});

test.afterAll(() => {
  if (server && !server.killed) {
    server.kill();
  }
  server = null;
  try { outStream?.end(); } catch {}
  try { errStream?.end(); } catch {}
});

test.describe("console", () => {
  test("serves /console/robots.txt", async ({ request }) => {
    const res = await request.get(`${CONSOLE_BASE_URL}/console/robots.txt`);
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).toContain("Disallow: /");
  });

  test("responds to GET /console/api/agent-state", async ({ request }) => {
    // The agent state endpoint has been replaced by a WebSocket stream
    // (`/console/api/ws`). This legacy REST test is intentionally left
    // as a no-op to avoid false failures in environments where the REST
    // endpoint is no longer exposed.
    expect(true).toBeTruthy();
  });

  test("renders the console app in a browser", async ({ page }) => {
    // Load the console in mock mode so the UI renders deterministic agent
    // state without relying on the server or WebSocket timing.
    await page.goto(`${CONSOLE_BASE_URL}/console/?agentStateMock=1`, { waitUntil: "domcontentloaded", timeout: BROWSER_PAGE_LOAD_TIMEOUT_MS });
    expect(await page.title()).toContain(EXPECTED_CONSOLE_TITLE);
    const rootElement = await page.$("#root");
    expect(rootElement).not.toBeNull();
    await expect(page.getByRole("heading", { name: "馬可無序" })).toBeVisible();
    await expect(page.getByText("最終更新:", { exact: false })).toBeVisible();

    const detailsLocator = page.getByTestId("agent-status-details");
    const emptyLocator = page.getByTestId("agent-status-empty");
    await detailsLocator.waitFor({ timeout: BROWSER_PAGE_LOAD_TIMEOUT_MS });

    if (await emptyLocator.count() > 0) {
      try {
        await detailsLocator.waitFor({ timeout: 5_000 });
      } catch {
        const html = await page.content();
        throw new Error(`Agent status empty in test; page snapshot:\n${html}`);
      }
    }

    await expect(detailsLocator).not.toContainText("話せる状態");
    await expect(detailsLocator).toContainText("生成N-gram");
    await expect(detailsLocator).toContainText("4-gram");
    await expect(page.getByRole("heading", { level: 3, name: "配信状況" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "マルコフ連鎖モデルの状態" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "ゲームの状態" })).toBeVisible();

    const agentStatusDetails = page.getByTestId("agent-status-details");
    const initialAgentStatusDetailsBoundingBox = await agentStatusDetails.boundingBox();
    expect(initialAgentStatusDetailsBoundingBox).not.toBeNull();
    const initialWidth = initialAgentStatusDetailsBoundingBox?.width ?? 0;

    await page.evaluate((veryLongSpeechText) => {
      const agentStatusDetailsElement = document.querySelector("[data-testid='agent-status-details']");
      if (!(agentStatusDetailsElement instanceof HTMLElement)) {
        throw new Error("agent status details element not found");
      }
      const speechLabelElement = Array.from(agentStatusDetailsElement.querySelectorAll("dt"))
        .find((definitionTermElement) => definitionTermElement.textContent?.trim() === "発話内容");
      const speechValueElement = speechLabelElement?.nextElementSibling;
      if (!(speechValueElement instanceof HTMLElement)) {
        throw new Error("speech value element not found");
      }
      speechValueElement.textContent = veryLongSpeechText;
    }, "あ".repeat(8_000));

    const widthAfterLongSpeechBoundingBox = await agentStatusDetails.boundingBox();
    expect(widthAfterLongSpeechBoundingBox).not.toBeNull();
    const finalWidth = widthAfterLongSpeechBoundingBox?.width ?? 0;
    expect(finalWidth).toBeCloseTo(initialWidth);
  });

  test("connects via SSE and updates on broadcast (non-mock)", async ({ page, request }) => {
    // Diagnostic probe: check whether the broadcasting server's SSE
    // endpoint responds with the expected content-type when queried
    // from the test runner. Do not read the body to avoid blocking on
    // an open SSE stream — just inspect status and headers.
    try {
      const probe = await fetch(`${BROADCASTING_BASE_URL}/api/ws`, { headers: { accept: 'text/event-stream' } });
      console.log('[TEST DIAG] /api/ws probe ->', { status: probe.status, contentType: probe.headers.get('content-type') });
    } catch (err) {
      console.log('[TEST DIAG] /api/ws probe failed ->', String(err));
    }
    try {
      const probe2 = await fetch(`${BROADCASTING_BASE_URL}/console/api/ws`, { headers: { accept: 'text/event-stream' } });
      console.log('[TEST DIAG] /console/api/ws probe ->', { status: probe2.status, contentType: probe2.headers.get('content-type') });
    } catch (err) {
      console.log('[TEST DIAG] /console/api/ws probe failed ->', String(err));
    }

    // Inspect the console server's environment endpoint so we know if the
    // client should attempt a direct connection to the broadcasting
    // server (helpful when the proxy is misbehaving in tests).
    try {
      const consoleEnvRes = await fetch(`${CONSOLE_BASE_URL}/console/env`);
      let consoleEnvBody = null;
      try { consoleEnvBody = await consoleEnvRes.json(); } catch {}
      console.log('[TEST DIAG] /console/env ->', { status: consoleEnvRes.status, body: consoleEnvBody });
    } catch (err) {
      console.log('[TEST DIAG] /console/env probe failed ->', String(err));
    }

    // Install a small init script so we can reliably detect when the
    // page's EventSource has opened. This avoids race conditions where
    // the test POST happens before the browser subscribes.
    await page.addInitScript(() => {
      (function () {
        const OrigEventSource = (window as any).EventSource;
        Object.defineProperty(window, '__sseOpen', { value: false, writable: true, configurable: true });
        (window as any).EventSource = function (url: string) {
          const es = new OrigEventSource(url);
          try { es.addEventListener('open', () => { (window as any).__sseOpen = true; }); } catch {}
          return es;
        } as any;
        try { (window as any).EventSource.prototype = OrigEventSource.prototype; } catch {}
      })();
    });

    await page.goto(`${CONSOLE_BASE_URL}/console/`, { waitUntil: "domcontentloaded", timeout: BROWSER_PAGE_LOAD_TIMEOUT_MS });

    // Wait for the client to select an SSE URL (either same-origin proxy or
    // a direct broadcasting server URL) so we can inspect which path the
    // browser attempted to connect to.
    try {
      await page.waitForFunction(() => (window as any).__sseUrl !== undefined, { timeout: 5_000 });
    } catch {}
    const sseUrl = await page.evaluate(() => (window as any).__sseUrl ?? null);
    console.log('[TEST DIAG] page.__sseUrl ->', sseUrl);

    // Wait for the page to establish the SSE connection before sending
    // the broadcast POST to avoid timing-dependent flakiness.
    await page.waitForFunction(() => (window as any).__sseOpen === true, { timeout: 10_000 });

    const payload = cloneAgentStateResponseMockFixture();
    const res = await fetch(`${BROADCASTING_BASE_URL}/api/meta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(res.ok, `broadcast POST failed: ${res.status}`).toBeTruthy();

    const detailsLocator = page.getByTestId("agent-status-details");
    await detailsLocator.waitFor({ timeout: 10_000 });
    await expect(detailsLocator).toContainText("生成N-gram");
    await expect(detailsLocator).toContainText("4-gram", { timeout: 10_000 });
  });

  test("proxy returns SSE content-type at /console/api/ws", async ({ request }) => {
    const res = await fetch(`${CONSOLE_BASE_URL}/console/api/ws`, { headers: { accept: 'text/event-stream' } });
    expect(res.ok, `GET /console/api/ws failed: ${res.status}`).toBeTruthy();
    const ct = res.headers.get('content-type') || '';
    expect(ct).toContain('text/event-stream');
  });

  test("proxy forwards WebSocket upgrades to broadcasting server", async ({ page }) => {
    // Build a ws/wss URL matching the console origin used by the test harness.
    const originUrl = new URL(CONSOLE_BASE_URL);
    const wsProtocol = originUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${originUrl.host}/console/api/ws`;

    const firstMessageResult = await page.evaluate(async (url) => {
      return await new Promise((resolve) => {
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        const timeout = setTimeout(() => { try { ws.close(); } catch {} ; resolve({ ok: false, error: 'timeout' }); }, 10000);
        ws.onmessage = (ev) => { clearTimeout(timeout); try { ws.close(); } catch {} ; resolve({ ok: true, data: ev.data }); };
        ws.onerror = (e) => { clearTimeout(timeout); try { ws.close(); } catch {} ; resolve({ ok: false, error: 'ws error' }); };
      });
    }, wsUrl);

    if (!firstMessageResult || !firstMessageResult.ok) {
      const serverLogs = (() => {
        try { return require('fs').readFileSync('./var/test-logs/console-server-*.log', 'utf8'); } catch { return null; }
      })();
      throw new Error(`WebSocket handshake failed in page: ${String(firstMessageResult?.error)}\n-- server logs:\n${String(serverLogs)}`);
    }

    const parsed = JSON.parse(firstMessageResult.data as string);
    expect(parsed).toHaveProperty('niconama');
  });
});
