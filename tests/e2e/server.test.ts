import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 17777;
const BASE_URL = `http://localhost:${PORT}`;
const SERVER_STARTUP_TIMEOUT_MS = 15_000;

let server: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  if (!existsSync("./var/cookieclicker.txt")) {
    writeFileSync("./var/cookieclicker.txt", "");
  }

  server = Bun.spawn(["bun", "start", "--port", String(PORT)], {
    stdout: "pipe",
    stderr: "pipe",
    // NODE_ENV=production is already set by the start script, but we keep it
    // explicit here to ensure tests always run in a production-like environment.
    env: { ...process.env, NODE_ENV: "production" },
  });

  // Wait for the server to be ready
  const reader = server.stdout.getReader();
  const decoder = new TextDecoder();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server startup timed out")), SERVER_STARTUP_TIMEOUT_MS);
    let buffer = "";
    const read = async (): Promise<void> => {
      try {
        const { value, done } = await reader.read();
        if (done) {
          clearTimeout(timeout);
          reject(new Error("Server process ended unexpectedly"));
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes("Server running")) {
          clearTimeout(timeout);
          resolve();
        } else {
          return read();
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    void read();
  });
});

afterAll(() => {
  server?.kill();
});

describe("server", () => {
  it("serves the frontend HTML", async () => {
    const res = await fetch(BASE_URL);
    expect(res.ok).toBeTrue();
    const html = await res.text();
    expect(html).toContain("<title>馬可無序");
    expect(html).toContain('<div id="root">');
    expect(html).toMatch(/<link\b[^>]*\bhref="\/favicon-32x32\.png"/);
  });

  it("responds to /api/speech", async () => {
    const res = await fetch(`${BASE_URL}/api/speech`);
    expect(res.ok).toBeTrue();
    const data = await res.json();
    expect(data).toHaveProperty("speech");
  });

  it("responds to /api/game", async () => {
    const res = await fetch(`${BASE_URL}/api/game`);
    expect(res.ok).toBeTrue();
  });

  it("responds to /api/meta", async () => {
    const res = await fetch(`${BASE_URL}/api/meta`);
    expect(res.ok).toBeTrue();
  });

  it("serves /nc433974.png", async () => {
    const res = await fetch(`${BASE_URL}/nc433974.png`);
    expect(res.ok).toBeTrue();
    expect(res.headers.get("content-type")).toStartWith("image/png");
  });

  it("serves /favicon-32x32.png", async () => {
    const res = await fetch(`${BASE_URL}/favicon-32x32.png`);
    expect(res.ok).toBeTrue();
    expect(res.headers.get("content-type")).toStartWith("image/png");
  });

  it("renders the app in a browser", async () => {
    // Verify the server is still running
    expect(server.exitCode).toBeNull();

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(BASE_URL);
      // The page title is part of the static HTML
      const title = await page.title();
      expect(title).toContain("馬可無序");
      // The React app root element should be present in the DOM
      const rootElement = await page.$("#root");
      expect(rootElement).not.toBeNull();
    } finally {
      await browser.close();
    }
  });
});
