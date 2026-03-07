import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";

const PORT = 7777;
const BASE_URL = `http://localhost:${PORT}`;
const SETUP_TIMEOUT = 60_000;
const TEST_TIMEOUT = 30_000;

const ROOT_DIR = join(import.meta.dir, "../..");
const DATA_FILE = join(ROOT_DIR, "var/cookieclicker.txt");

describe("server startup", () => {
  let server: ReturnType<typeof Bun.spawn>;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let createdDataFile = false;

  beforeAll(async () => {
    // Create the data file if it doesn't exist so `bun start` can read it
    if (!existsSync(DATA_FILE)) {
      writeFileSync(DATA_FILE, "");
      createdDataFile = true;
    }

    // Start the production server using the same command as `bun start`
    server = Bun.spawn(
      ["bun", "run", "start"],
      {
        cwd: ROOT_DIR,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    // Poll until the server is ready to accept connections
    let ready = false;
    for (let i = 0; i < 120; i++) {
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
    if (createdDataFile) {
      rmSync(DATA_FILE, { force: true });
    }
  });

  it("should serve http://localhost:7777 without browser console errors", async () => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    page.on("pageerror", (error) => {
      if (error instanceof Error) {
        pageErrors.push(error.message);
      } else {
        pageErrors.push(String(error));
      }
    });

    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    // Allow time for any deferred/async errors (e.g. React effects) to surface
    await Bun.sleep(2_000);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  }, TEST_TIMEOUT);
});
