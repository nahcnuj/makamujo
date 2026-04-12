import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPopupPageHandler, createRedirectToHomeHandler } from "../../../lib/Browser/chromium";

/** Starts a minimal HTTP server on a random port and returns the server and its base URL. */
function startLocalServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body></body></html>");
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/** Stops the given HTTP server, returning a promise that resolves when the server is closed. */
function stopLocalServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

test.describe("Ad protection (real browser)", () => {
  test("closes popup tabs opened in the browser context", async ({ browser }) => {
    const { server, baseUrl } = await startLocalServer();
    const homeUrl = `${baseUrl}/home`;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    ctx.on("page", createPopupPageHandler(page));

    await page.goto(homeUrl);

    // Open a new page in the same context to simulate an ad popup tab.
    // This fires the BrowserContext 'page' event, which createPopupPageHandler will close.
    const newPageClosed = new Promise<void>((resolve) => {
      ctx.once("page", (p) => p.once("close", () => resolve()));
    });
    void ctx.newPage(); // not awaited — handler closes it immediately

    await newPageClosed;

    expect(ctx.pages()).toHaveLength(1);
    expect(ctx.pages()[0]).toBe(page);

    await ctx.close();
    await stopLocalServer(server);
  });

  test("redirects main page back to home when it navigates away", async ({ browser }) => {
    const { server, baseUrl } = await startLocalServer();
    const homeUrl = `${baseUrl}/home`;
    const awayUrl = `${baseUrl}/away`;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto(homeUrl);

    page.on(
      "framenavigated",
      createRedirectToHomeHandler(
        page.mainFrame(),
        homeUrl,
        (url) => page.goto(url, { waitUntil: "domcontentloaded" }),
      ),
    );

    // Trigger a JavaScript-driven navigation to simulate an ad redirect.
    // page.evaluate() will be aborted by the navigation itself, so catch silently.
    page.evaluate((url) => { window.location.href = url; }, awayUrl).catch(() => undefined);

    // Wait until the redirect handler brings the page back to homeUrl.
    await page.waitForURL((url) => url.toString().startsWith(homeUrl), { timeout: 10_000 });

    expect(page.url()).toMatch(new RegExp(`^${homeUrl}`));

    await ctx.close();
    await stopLocalServer(server);
  });
});
