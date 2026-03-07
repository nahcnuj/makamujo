import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";

const PORT = 7777;
const BASE_URL = `http://localhost:${PORT}`;
const SETUP_TIMEOUT = 60_000;
const TEST_TIMEOUT = 30_000;

describe("server startup", () => {
  let server: ReturnType<typeof Bun.spawn>;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let tmpDir: string;

  beforeAll(async () => {
    // Create a minimal data file so the server can start without pre-existing var/ files
    tmpDir = join(tmpdir(), `makamujo-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const dataFile = join(tmpDir, "cookieclicker.txt");
    writeFileSync(dataFile, "");

    // Start the production server
    server = Bun.spawn(
      ["bun", `--port=${PORT}`, "index.ts", "--data", dataFile],
      {
        env: { ...process.env, NODE_ENV: "production" },
        cwd: import.meta.dir,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    // Poll until the server is ready to accept connections
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(BASE_URL);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        await Bun.sleep(500);
      }
    }
    if (!ready) {
      server.kill();
      throw new Error(`Server did not become ready within ${SETUP_TIMEOUT / 1000} seconds`);
    }

    // Launch a headless browser to access the page
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    await context?.close();
    await browser?.close();
    server?.kill();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should serve http://localhost:7777 without browser console errors", async () => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    // Allow time for any deferred/async errors (e.g. React effects) to surface
    await Bun.sleep(2_000);

    expect(errors).toEqual([]);
  }, TEST_TIMEOUT);
});
