/**
 * Optional Chromium integration against the local stub fixture.
 * Uses `it.skip` when Chromium cannot launch (evaluated before registration).
 * Deterministic coverage lives in:
 *   lib/Agent/games/work.nahcnuj.www/vigilant-fiesta/play-loop.harness.test.ts
 */
import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Action } from "automated-gameplay-transmitter";
import { getGameHomeUrl } from "../../lib/Agent/games/work.nahcnuj.www/vigilant-fiesta/server";
import { solver } from "../../lib/Agent/games/work.nahcnuj.www/vigilant-fiesta/solver";

process.env.VIGILANT_FIESTA_FREE_TALK_MS = "80";

const fixturePath = resolve(
  import.meta.dir,
  "../fixtures/vigilant-fiesta-stub.html",
);
const fixtureHtml = readFileSync(fixturePath, "utf-8");

let server: Server | undefined;
let baseUrl = "";
let browser: import("playwright").Browser | undefined;

// Launch Chromium before registering tests so we can use the standard `it.skip`
// API (condition must be known at registration time — `beforeAll` is too late).
try {
  const { chromium } = await import("playwright");
  browser = await Promise.race([
    chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    }),
    delay(15_000).then(() => {
      throw new Error("chromium.launch timed out after 15s");
    }),
  ]);
} catch (err) {
  console.warn(
    "[WARN] skip chromium play-loop:",
    err instanceof Error ? err.message : String(err),
  );
  browser = undefined;
}

const itWithChromium = browser ? it : it.skip;

server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fixtureHtml);
});
await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
{
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/`;
  process.env.VIGILANT_FIESTA_HOME_URL = baseUrl;
}

afterAll(async () => {
  await browser?.close().catch(() => {});
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
  }
  delete process.env.VIGILANT_FIESTA_HOME_URL;
  delete process.env.VIGILANT_FIESTA_FREE_TALK_MS;
});

const readScreenState = async (
  page: import("playwright").Page,
): Promise<{
  screen: "title" | "playing" | "result" | "unknown";
  score: number;
  level: number;
  url: string;
}> =>
  page.evaluate(() => {
    const isVisible = (el: HTMLElement | null) =>
      !!el && !el.hasAttribute("hidden");
    let screen: "title" | "playing" | "result" | "unknown" = "unknown";
    if (isVisible(document.getElementById("screen-title"))) screen = "title";
    else if (isVisible(document.getElementById("result-overlay")))
      screen = "result";
    else if (isVisible(document.getElementById("screen-playing")))
      screen = "playing";
    const textOf = (el: HTMLElement | null) =>
      (el?.innerText || el?.textContent || "").trim();
    const scoreText =
      screen === "result"
        ? textOf(document.getElementById("result-score")) ||
          textOf(document.getElementById("score"))
        : textOf(document.getElementById("score"));
    return {
      screen,
      score: Number.parseInt(
        (scoreText.match(/Score:\s*([\d,]+)/i)?.[1] ?? "NaN").replaceAll(
          ",",
          "",
        ),
        10,
      ),
      level: 1,
      url: location.href,
    };
  });

describe("vigilant-fiesta agent play loop (chromium + stub)", () => {
  itWithChromium(
    "starts, plays keys, free-talks after game over, then retries",
    async () => {
      if (!browser) {
        throw new Error("browser missing despite itWithChromium registration");
      }

      expect(getGameHomeUrl()).toBe(baseUrl);
      const page = await browser.newPage();

      try {
        const gen = solver({ type: "initialize" });
        let event: any = undefined;
        let sawPress = false;
        let sawRetry = false;
        let sawStart = false;
        let sawResultScreen = false;
        let returnedToPlayingAfterRetry = false;
        let sawOpen = false;

        for (let i = 0; i < 100; i++) {
          const next = event === undefined ? gen.next() : gen.next(event);
          if (next.done) break;
          const action = next.value as Action.Action;

          if (action.name === "open") sawOpen = true;
          if (
            action.name === "click" &&
            (action as any).target?.id === "btn-start"
          )
            sawStart = true;
          if (action.name === "press") sawPress = true;
          if (
            action.name === "click" &&
            (action as any).target?.id === "btn-retry"
          )
            sawRetry = true;

          try {
            if (action.name === "noop") {
              await delay(25);
              const state = await readScreenState(page);
              if (state.screen === "result") sawResultScreen = true;
              if (sawRetry && state.screen === "playing")
                returnedToPlayingAfterRetry = true;
              // Always report home URL so away-detection does not re-open forever
              // when setContent leaves location as about:blank.
              event = { name: "idle", url: baseUrl, state };
              if (
                sawRetry &&
                returnedToPlayingAfterRetry &&
                sawPress &&
                sawStart
              )
                break;
              continue;
            }

            if (action.name === "open") {
              await page.goto(action.url, {
                waitUntil: "domcontentloaded",
                timeout: 10_000,
              });
              if ((await page.locator("#btn-start").count()) === 0) {
                await page.setContent(fixtureHtml, { waitUntil: "load" });
              }
              await page
                .locator("#btn-start")
                .waitFor({ state: "attached", timeout: 5_000 });
            } else if (action.name === "click" && action.target.type === "id") {
              const selector = `#${CSS.escape(action.target.id)}`;
              await page.locator(selector).click({ timeout: 5_000 });
              if (
                action.target.id === "btn-start" ||
                action.target.id === "btn-retry"
              ) {
                await page.waitForFunction(
                  () => {
                    const playing = document.getElementById("screen-playing");
                    return !!playing && !playing.hasAttribute("hidden");
                  },
                  undefined,
                  { timeout: 5_000 },
                );
              }
            } else if (action.name === "press") {
              await page
                .locator("#game-container")
                .focus()
                .catch(() => {});
              await page.keyboard.press(action.key);
            }
            event = { name: "result", succeeded: true, action };
          } catch {
            event = { name: "result", succeeded: false, action };
          }
        }

        expect(sawOpen).toBe(true);
        expect(sawStart).toBe(true);
        expect(sawPress).toBe(true);
        expect(sawResultScreen).toBe(true);
        expect(sawRetry).toBe(true);
        expect(returnedToPlayingAfterRetry).toBe(true);
      } finally {
        await page.close();
      }
    },
    60_000,
  );
});
