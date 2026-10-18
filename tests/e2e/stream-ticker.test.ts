import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const PORT = 17780;
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
  mkdirSync("./var", { recursive: true });
  if (!existsSync("./var/cookieclicker.txt")) {
    writeFileSync("./var/cookieclicker.txt", "");
  }
  const randomId =
    Date.now().toString(36) + Math.random().toString(36).slice(2);
  const ipcPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\makamujo-ipc-ticker-${randomId}`
      : join(process.cwd(), "var", `ipc-ticker-${randomId}.sock`);

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

function translateX(page: import("@playwright/test").Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return 0;
    const transform = getComputedStyle(el).transform;
    if (transform === "none") return 0;
    return new DOMMatrix(transform).m41;
  }, selector);
}

test.describe("stream ticker", () => {
  test("keeps an always-on motion rail inside the game clip", async ({
    page,
  }) => {
    await page.goto(BASE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    const rail = page.locator('[data-testid="stream-ticker"]');
    await expect(rail).toBeVisible({ timeout: 5_000 });

    // ゲーム枠（左 60% = x < 768）にまたがって伸びること。
    const box = await rail.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x).toBeLessThan(768);
    expect(box?.width ?? 0).toBeGreaterThan(700);

    const animated = page.locator('[data-testid="stream-ticker"] > div');
    const animation = await animated.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        name: style.animationName,
        iterationCount: style.animationIterationCount,
      };
    });
    expect(animation.name).toBe("ticker-rail-scroll");
    expect(animation.iterationCount).toBe("infinite");

    await expect(
      page.locator('[data-testid="stream-ticker"] > div > div'),
    ).toHaveCount(2);

    const selector = '[data-testid="stream-ticker"] > div';
    const before = await translateX(page, selector);
    await page.waitForTimeout(400);
    const after = await translateX(page, selector);
    // 左方向へ進み、静止していないこと（400ms で 100px 以上）。
    expect(before - after).toBeGreaterThan(100);
  });
});
