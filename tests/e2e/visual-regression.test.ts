import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const PORT = 17779;
const BASE_URL = `http://localhost:${PORT}`;
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
  if (!existsSync("./var/cookieclicker.txt")) {
    writeFileSync("./var/cookieclicker.txt", "");
  }
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
      body: JSON.stringify({}),
    });
  });
  await page.route("**/api/meta", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        nGram: 1,
        commentCount: 1,
        previousStreamCommentCount: 0,
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
  await page.goto(BASE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  const speechLocator = page.getByText("こんにちは世界").first();
  await speechLocator.waitFor({ state: "visible", timeout: 10_000 });
  await page.clock.pauseAt(new Date(FIXED_CLOCK_MS + 60_000));
}

test.describe("stream visual regression", () => {
  test("renders the overlay at the OBS output resolution of 1280x720", async ({
    page,
  }) => {
    await renderBroadcastScreen(page, 1280, 720);
    await expect(page).toHaveScreenshot("stream-overlay-1280x720.png");
  });

  test("renders the streaming display at the Xvfb canvas resolution of 2560x1440", async ({
    page,
  }) => {
    await renderBroadcastScreen(page, 2560, 1440);
    await expect(page).toHaveScreenshot("stream-display-2560x1440.png");
  });
});
