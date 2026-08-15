/**
 * Optional Chromium integration against the local stub fixture.
 * Uses `it.skip` when Chromium cannot launch (must be known at registration time).
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
// API (`beforeAll` is too late — skipIf is evaluated at registration).
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

type ScreenState = {
  screen: "title" | "playing" | "result" | "unknown";
  score: number;
  level: number;
};

const readScreenState = (
  page: import("playwright").Page,
): Promise<ScreenState> =>
  page.evaluate(() => {
    const isVisible = (el: HTMLElement | null) =>
      !!el && !el.hasAttribute("hidden");
    let screen: ScreenState["screen"] = "unknown";
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
    };
  });

const applyAction = async (
  page: import("playwright").Page,
  action: Action.Action,
): Promise<boolean> => {
  try {
    if (action.name === "noop") {
      await delay(25);
      return true;
    }
    if (action.name === "open") {
      // Establish origin, then inject fixture so scripts always run.
      await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 10_000,
      });
      await page.setContent(fixtureHtml, { waitUntil: "load" });
      await page
        .locator("#btn-start")
        .waitFor({ state: "attached", timeout: 5_000 });
      return true;
    }
    if (action.name === "click" && action.target.type === "id") {
      const id = action.target.id;
      await page.evaluate((elementId) => {
        const el = document.getElementById(elementId);
        if (!el) throw new Error(`missing #${elementId}`);
        el.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      }, id);
      if (id === "btn-start" || id === "btn-retry") {
        const playing = await page.evaluate(() => {
          const el = document.getElementById("screen-playing");
          return !!el && !el.hasAttribute("hidden");
        });
        if (!playing) return false;
      }
      return true;
    }
    if (action.name === "press") {
      await page.evaluate((key) => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, action.key);
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

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
            (action as { target?: { id?: string } }).target?.id === "btn-start"
          ) {
            sawStart = true;
          }
          if (action.name === "press") sawPress = true;
          if (
            action.name === "click" &&
            (action as { target?: { id?: string } }).target?.id === "btn-retry"
          ) {
            sawRetry = true;
          }

          if (action.name === "noop") {
            await applyAction(page, action);
            const state = await readScreenState(page);
            if (state.screen === "result") sawResultScreen = true;
            if (sawRetry && state.screen === "playing") {
              returnedToPlayingAfterRetry = true;
            }
            // Report home URL so away-detection does not re-open forever.
            event = { name: "idle", url: baseUrl, state };
            if (
              sawRetry &&
              returnedToPlayingAfterRetry &&
              sawPress &&
              sawStart
            ) {
              break;
            }
            continue;
          }

          const ok = await applyAction(page, action);
          event = { name: "result", succeeded: ok, action };
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
