import { expect, test, type Locator, type Page } from "@playwright/test";
import { spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";

const PORT = 17778;
const BASE_URL = `http://localhost:${PORT}`;
const SERVER_STARTUP_TIMEOUT_MS = 15_000;

let server: ReturnType<typeof spawn> | null = null;

const waitForServerReady = async () => {
  return new Promise<void>((resolve, reject) => {
    if (!server?.stdout) {
      reject(new Error("Server process not started"));
      return;
    }
    const timeout = setTimeout(
      () => reject(new Error("Server startup timed out")),
      SERVER_STARTUP_TIMEOUT_MS,
    );
    let buffer = "";
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
  });
};

test.beforeAll(async () => {
  if (!existsSync("./var/cookieclicker.txt")) {
    writeFileSync("./var/cookieclicker.txt", "");
  }
  const randomId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const ipcPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\makamujo-ipc-speech-${randomId}`
      : join(process.cwd(), "var", `ipc-speech-${randomId}.sock`);

  server = spawn(
    process.platform === "win32" ? "bun.exe" : "bun",
    ["index.ts", "--port", String(PORT)],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        CONSOLE_LOOPBACK_ONLY: "1",
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

async function mockApis(
  page: Page,
  getSpeech: () => { speech: string; silent?: boolean },
) {
  await page.route("**/api/speech", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(getSpeech()),
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
      body: JSON.stringify({ nGram: 1 }),
    });
  });
}

/** Thin locator helper for aria-hidden speech text. */
function speechTextLocator(page: Page, text: string): Locator {
  return page.locator('[aria-hidden="true"]', { hasText: text });
}

test.describe("speech display", () => {
  test("keeps at most two continuation utterances", async ({ page }) => {
    let speech = "一行目";
    await mockApis(page, () => ({ speech, silent: false }));

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await expect(speechTextLocator(page, "一行目")).toBeAttached({ timeout: 5_000 });

    speech = "二行目";
    await expect(speechTextLocator(page, "二行目")).toBeAttached({ timeout: 5_000 });
    await expect(speechTextLocator(page, "一行目")).toBeAttached();

    speech = "三行目";
    await expect(speechTextLocator(page, "三行目")).toBeAttached({ timeout: 5_000 });
    await expect(speechTextLocator(page, "二行目")).toBeAttached();
    // After rise animation, the first utterance should be gone.
    await expect(speechTextLocator(page, "一行目")).toHaveCount(0, { timeout: 2_000 });
  });

  test("replaces on ありがとうございます！ interrupt", async ({ page }) => {
    let speech = "途中の話";
    await mockApis(page, () => ({ speech, silent: false }));

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await expect(speechTextLocator(page, "途中の話")).toBeAttached({ timeout: 5_000 });

    speech = "太郎さん、広告ありがとうございます！";
    await expect(
      speechTextLocator(page, "太郎さん、広告ありがとうございます！"),
    ).toBeAttached({ timeout: 5_000 });
    await expect(speechTextLocator(page, "途中の話")).toHaveCount(0);
  });

  test("starts new topic after 。", async ({ page }) => {
    let speech = "昨日の話。";
    await mockApis(page, () => ({ speech, silent: false }));

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await expect(speechTextLocator(page, "昨日の話")).toBeAttached({ timeout: 5_000 });

    speech = "次の話題";
    await expect(speechTextLocator(page, "次の話題")).toBeAttached({ timeout: 5_000 });
    await expect(speechTextLocator(page, "昨日の話")).toHaveCount(0);
  });
});
