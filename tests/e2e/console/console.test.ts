import { expect, test } from "@playwright/test";
import { spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";

const CONSOLE_BASE_URL = `https://localhost`;
const SERVER_STARTUP_TIMEOUT_MS = 15_000;
const BROWSER_PAGE_LOAD_TIMEOUT_MS = 20_000;
const EXPECTED_CONSOLE_TITLE = "馬可無序 - 管理コンソール";

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
      reject(new Error("Server stdout/stderr stream not available"));
      return;
    }

    server.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes("Console running")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    server.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server process exited early with code ${code}`));
    });
  });
};

test.beforeAll(async () => {
  if (!existsSync("./var/cookieclicker.txt")) {
    writeFileSync("./var/cookieclicker.txt", "");
  }

  server = spawn(
    process.platform === "win32" ? "bun.exe" : "bun",
    ["start"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  await waitForServerReady();
});

test.afterAll(() => {
  if (server && !server.killed) {
    server.kill();
  }
  server = null;
});

test.describe("console", () => {
  test("serves /console/robots.txt", async ({ request }) => {
    const res = await request.get(`${CONSOLE_BASE_URL}/console/robots.txt`);
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).toContain("Disallow: /");
  });

  test("responds to GET /console/api/hello", async ({ request }) => {
    const res = await request.get(`${CONSOLE_BASE_URL}/console/api/hello`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("message", "Hello, world!");
    expect(data).toHaveProperty("method", "GET");
  });

  test("responds to PUT /console/api/hello", async ({ request }) => {
    const res = await request.put(`${CONSOLE_BASE_URL}/console/api/hello`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("message", "Hello, world!");
    expect(data).toHaveProperty("method", "PUT");
  });

  test("responds to GET /console/api/hello/:name", async ({ request }) => {
    const res = await request.get(`${CONSOLE_BASE_URL}/console/api/hello/world`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("message", "Hello, world!");
  });

  test("renders the console app in a browser", async ({ page }) => {
    await page.goto(`${CONSOLE_BASE_URL}/console/`, { waitUntil: "domcontentloaded", timeout: BROWSER_PAGE_LOAD_TIMEOUT_MS });
    expect(await page.title()).toContain(EXPECTED_CONSOLE_TITLE);
    const rootElement = await page.$("#root");
    expect(rootElement).not.toBeNull();
  });
});
