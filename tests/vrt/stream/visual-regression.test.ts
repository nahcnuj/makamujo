import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { expect, test } from "@playwright/test";

const PORT = 17779;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 30_000;

let server: ChildProcessWithoutNullStreams | null = null;

async function waitForServerReady(): Promise<void> {
  if (!server || !server.stdout || !server.stderr) {
    throw new Error("Server process was not started");
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Server startup timed out after ${SERVER_START_TIMEOUT_MS}ms`,
        ),
      );
    }, SERVER_START_TIMEOUT_MS);

    const clean = () => {
      server!.stdout.off("data", onData);
      server!.stderr.off("data", onData);
      server!.off("exit", onExit);
      clearTimeout(timeout);
    };

    const onData = (chunk: Buffer | string) => {
      const text = String(chunk);
      if (
        /server running|listening|ready|started|http:\/\/127\.0\.0\.1/i.test(
          text,
        )
      ) {
        clean();
        resolve();
      }
    };

    const onExit = (code: number | null) => {
      clean();
      reject(new Error(`Server exited early with code ${code ?? "unknown"}`));
    };

    server.stdout.on("data", onData);
    server.stderr.on("data", onData);
    server.on("exit", onExit);
  });
}

test.beforeAll(async () => {
  server = spawn("bun", ["index.ts", "--port", String(PORT)], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      CONSOLE_LOOPBACK_ONLY: "1",
      NICONAMA_WATCH_PAGE_DISABLED: "1",
      PORT: String(PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForServerReady();
});

test.afterAll(async () => {
  if (!server) return;

  await new Promise<void>((resolve) => {
    const close = () => {
      server = null;
      resolve();
    };

    if (server.killed) {
      close();
      return;
    }

    server.once("exit", close);
    server.kill("SIGTERM");

    setTimeout(() => {
      if (server && !server.killed) {
        server.kill("SIGKILL");
      }
      close();
    }, 5_000);
  });
});

test.describe("OBS preview render regression", () => {
  test("renders the real stream preview at 1280x720 without visual drift", async ({
    page,
  }) => {
    await page.route("**/api/speech", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          speech: "こんにちは世界",
          silent: false,
        }),
      });
    });

    await page.route("**/api/game", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          name: "VigilantFiesta",
          state: {
            sessionBest: 12345,
            allTimeBest: 99999,
          },
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
              title: "VRT: OBS preview regression check",
              url: "https://example.com/watch/vrt",
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

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(BASE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const streamCandidates = [
      page.locator("canvas"),
      page.locator("video"),
      page.locator("iframe"),
      page.locator("[data-stream-root]"),
      page.locator("[data-preview]"),
      page.locator("body"),
    ];

    await Promise.any(
      streamCandidates.map(async (locator) => {
        await locator.waitFor({ state: "visible", timeout: 20_000 });
      }),
    ).catch(() => {
      // Keep the test usable if the exact DOM root differs; the screenshot is
      // still the real guardrail for preview drift.
    });

    await page.waitForTimeout(2_000);

    await expect(page).toHaveScreenshot("obs-preview-1280x720.png", {
      animations: "disabled",
      maxDiffPixels: 250,
      fullPage: false,
    });
  });
});
