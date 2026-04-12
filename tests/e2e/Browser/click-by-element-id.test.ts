import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createClickByElementId } from "../../../lib/Browser/chromium";

/** Starts a minimal HTTP server on a random port serving the given HTML. */
function startLocalServer(html: string): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
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

test.describe("createClickByElementId (real browser)", () => {
  test("clicks the first element when multiple elements share the same id", async ({ browser }) => {
    // Reproduce the exact HTML structure from Cookie Clicker prompt dialogs (issue #121),
    // where two <a> elements both have id="promptOption0".
    const html = `<!DOCTYPE html><html><body>
      <a id="promptOption0" class="option smallFancyButton focused" onclick="window._clicked='first'">昇天する</a>
      <a class="option" id="promptOption0" onclick="window._clicked='second'">はい</a>
    </body></html>`;

    const { server, baseUrl } = await startLocalServer(html);
    try {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      try {
        await page.goto(baseUrl);

        await createClickByElementId(page)("promptOption0");

        const clicked = await page.evaluate(() => (window as any)._clicked);
        expect(clicked).toBe("first");
      } finally {
        await ctx.close();
      }
    } finally {
      await stopLocalServer(server);
    }
  });
});
