import { spawn } from "node:child_process";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const PORT = 17779;
const BASE_URL = `http://localhost:${PORT}`;
const GAME_PAGE_URL = "https://www.nahcnuj.work/vigilant-fiesta/";
const SERVER_STARTUP_TIMEOUT_MS = 15_000;

let server: ReturnType<typeof spawn> | null = null;

const waitForServerReady = async (): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    if (!server) {
      reject(new Error("Server process not started"));
      return;
    }

    const timeout = setTimeout(
      () => reject(new Error("Server startup timed out")),
      SERVER_STARTUP_TIMEOUT_MS,
    );

    let buffer = "";
    if (!server.stdout || !server.stderr) {
      reject(new Error("Server stdout/stderr stream not available"));
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

    server.stderr.on("data", (_chunk) => {
      // optionally log server stderr for diagnosis
      // console.error("server stderr:", chunk);
    });
  });
};

test.beforeAll(async () => {
  const randomId =
    Date.now().toString(36) + Math.random().toString(36).slice(2);
  const ipcPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\makamujo-ipc-visual-${randomId}`
      : join(process.cwd(), "var", `ipc-visual-${randomId}.sock`);

  server = spawn(
    process.platform === "win32" ? "bun.exe" : "bun",
    ["index.ts", "--port", String(PORT)],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        CONSOLE_LOOPBACK_ONLY: "1",
        NICONAMA_WATCH_PAGE_DISABLED: "1",
        MAKAMUJO_IPC_PATH: ipcPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServerReady();
});

test.afterAll(() => {
  if (server && !server.killed) server.kill();
  server = null;
});

const FIXED_CLOCK_MS = new Date("2026-10-28T23:59:59+09:00").getTime();

async function mockApis(page: Page) {
  await page.route(GAME_PAGE_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<!doctype html><html><body style="margin:0;background:#111;color:#eee;font-family:sans-serif;display:grid;place-items:center;height:100vh">vigilant-fiesta game screen</body></html>',
    });
  });
  await page.route("**/api/speech", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ speech: "こんにちは世界", silent: false }),
    });
  });
  await page.route("**/api/game", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: "VigilantFiesta",
        state: { sessionBest: 12345, allTimeBest: 99999 },
      }),
    });
  });
  await page.route("**/api/meta", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        niconama: {
          type: "live",
          meta: {
            title: "配信エージェント状態モック",
            url: "https://example.com/watch/mock",
            start: 1717000000,
            total: {
              listeners: 123,
              gift: 456,
              ad: 789,
              comments: 10,
            },
          },
        },
        nGram: 4,
        commentCount: 321,
        previousStreamCommentCount: 10,
      }),
    });
  });
}

async function renderBroadcastScreen(
  page: Page,
  width: number,
  height: number,
) {
  await page.setViewportSize({ width, height });
  await page.clock.install({ time: new Date(FIXED_CLOCK_MS) });
  await page.clock.resume();
  await mockApis(page);
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const frame = document.createElement("iframe");
      frame.src = "https://www.nahcnuj.work/vigilant-fiesta/";
      frame.style.cssText =
        "position:fixed;top:0;left:0;width:1280px;height:720px;border:0;z-index:-1;";
      document.body.prepend(frame);
    });
  });
  await page.goto(BASE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  const speechLocator = page.getByText("こんにちは世界").first();
  await speechLocator.waitFor({ state: "visible", timeout: 10_000 });
  await page
    .frameLocator(`iframe[src="${GAME_PAGE_URL}"]`)
    .getByText("vigilant-fiesta game screen")
    .waitFor({ state: "visible", timeout: 10_000 });
  await page.clock.pauseAt(new Date(FIXED_CLOCK_MS + 60_000));
}

test.describe("stream visual regression", () => {
  test("renders the overlay at the OBS output resolution of 1280x720", async ({
    page,
  }) => {
    await renderBroadcastScreen(page, 1280, 720);
    await expect(page).toHaveScreenshot("stream-overlay-1280x720.png", {
      maxDiffPixels: 250,
    });
  });
});
