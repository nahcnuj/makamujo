import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

function startLocalServer(
  html: string,
): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function stopLocalServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

test.describe("docs/index.html X conversion tag", () => {
  test("fires twq with parameters when the niconico live link is clicked", async ({
    browser,
  }) => {
    const html = readFileSync("docs/index.html", "utf-8");
    const { server, baseUrl } = await startLocalServer(html);
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as unknown as { __twqCalls: unknown[][] }).__twqCalls = [];
        (window as unknown as { twq: (...args: unknown[]) => void }).twq = (
          ...args: unknown[]
        ) => {
          (window as unknown as { __twqCalls: unknown[][] }).__twqCalls.push(
            args,
          );
        };
        (window as unknown as { open: () => null }).open = () => null;
      });

      await page.route("https://live.nicovideo.jp/**", (route) =>
        route.abort(),
      );
      await page.route("https://static.ads-twitter.com/**", (route) =>
        route.abort(),
      );

      try {
        await page.goto(baseUrl);
        await page.click("#live-link");

        const calls = await page.evaluate(
          () => (window as unknown as { __twqCalls: unknown[][] }).__twqCalls,
        );
        const eventCall = (calls as unknown[][]).find(
          (c) => c[0] === "event" && c[1] === "tw-ov0j6-rdexl",
        );
        expect(eventCall).toBeTruthy();
        expect(eventCall?.[2]).toEqual({ value: 5, currency: "USD" });
      } finally {
        await context.close();
      }
    } finally {
      await stopLocalServer(server);
    }
  });
});
