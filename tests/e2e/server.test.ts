import { expect, test } from "@playwright/test";
import { spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";

const PORT = 17777;
const BASE_URL = `http://localhost:${PORT}`;
const SERVER_STARTUP_TIMEOUT_MS = 15_000;

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

  server = spawn(process.platform === "win32" ? "bun.exe" : "bun", ["start", "--port", String(PORT)], {
    env: { ...process.env, NODE_ENV: "production" },
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
    const res = await request.get(BASE_URL);
    expect(res.ok()).toBeTruthy();
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
  });

  test("responds to /api/game", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/game`);
    expect(res.ok()).toBeTruthy();
  });

  test("responds to /api/meta", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/meta`);
    expect(res.ok()).toBeTruthy();
  });

  test("accepts POST /api/meta", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/meta`, {
      data: { data: { type: 'niconama', data: { isLive: false, title: 'test', startTime: 0, total: 0, points: { gift: 0, ad: 0 }, url: 'https://example.com' } } },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("accepts PUT / via comment route", async ({ request }) => {
    const postRes = await request.post(`${BASE_URL}/`);
    expect(postRes.ok()).toBeTruthy();

    const res = await request.put(`${BASE_URL}/`, {
      data: [{ data: { comment: 'hello', no: 1, anonymity: false, hasGift: false } }],
    });
    expect(res.ok()).toBeTruthy();
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

  test("renders the app in a browser", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    expect(await page.title()).toContain("馬可無序");
    const rootElement = await page.$("#root");
    expect(rootElement).not.toBeNull();
  });
});

