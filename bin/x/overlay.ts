#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Overlay browser for OBS "Comment" (XSHM left crop).
 * Geometry: 1280x720 at (0, 40) — game stays at (1280, 40).
 * Uses --app= and reuses that window (no second tabbed window).
 */
import { chromium } from "playwright";
import {
  createSweptTemporaryProfileDir,
  releaseTemporaryProfileDir,
} from "../../lib/Browser/tempProfile";

process.env.DISPLAY = process.env.DISPLAY || ":10";

const url = process.env.OVERLAY_URL || "http://127.0.0.1:7777/";
const userDataDir = createSweptTemporaryProfileDir("makamujo-overlay-");
mkdirSync(join(userDataDir, "Default"), { recursive: true });
writeFileSync(
  join(userDataDir, "Default", "Preferences"),
  JSON.stringify({
    translate: { enabled: false },
    browser: { translate: { enabled: false } },
  }),
  { mode: 0o600 },
);

console.log(
  "[INFO] overlay browser DISPLAY=",
  process.env.DISPLAY,
  "url=",
  url,
);

// A launch that never gets this far would strand the profile, and a crash
// that skips these handlers is swept by the next start (#658).
let released = false;
const releaseProfileDir = () => {
  if (released) return;
  released = true;
  releaseTemporaryProfileDir(userDataDir);
};

const context = await chromium
  .launchPersistentContext(userDataDir, {
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
  })
  .catch((err) => {
    releaseProfileDir();
    throw err;
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

context.on("close", releaseProfileDir);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    releaseProfileDir();
    process.exit(0);
  });
}
context.on("close", () => process.exit(0));
await new Promise(() => {});
