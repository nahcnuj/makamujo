#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/**
 * Overlay browser for OBS "Comment" (XSHM left crop).
 * Geometry: 1280x720 at (0, 40) — game stays at (1280, 40).
 * Uses --app= and reuses that window (no second tabbed window).
 */
import { chromium } from "playwright";

process.env.DISPLAY = process.env.DISPLAY || ":10";

const url = process.env.OVERLAY_URL || "http://127.0.0.1:7777/";
const userDataDir = join(tmpdir(), `makamujo-overlay-${process.pid}`);
mkdirSync(join(userDataDir, "Default"), { recursive: true });
writeFileSync(
  join(userDataDir, "Default", "Preferences"),
  JSON.stringify({
    translate: { enabled: false },
    browser: { translate: { enabled: false } },
  }),
);

console.log(
  "[INFO] overlay browser DISPLAY=",
  process.env.DISPLAY,
  "url=",
  url,
);

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  ignoreDefaultArgs: ["--no-startup-window"],
  locale: "ja-JP",
  viewport: { width: 1280, height: 720 },
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=1280,720",
    "--window-position=0,40",
    "--class=MakamujoComment",
    "--disable-features=Translate,TranslateUI,TranslateScript,OptimizationHints",
    "--disable-translate",
    "--lang=ja",
    `--app=${url}`,
  ],
});

// Reuse the app window; do NOT open a second tabbed page.
let page = context.pages()[0];
if (!page) {
  page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
} else if (page.url() === "about:blank") {
  await page.goto(url, { waitUntil: "domcontentloaded" });
}
console.log("[INFO] overlay loaded", page.url());

context.on("close", () => process.exit(0));
await new Promise(() => {});
