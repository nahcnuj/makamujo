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
  createTemporaryDirectory,
  OVERLAY_TEMPORARY_DIRECTORY_PREFIX,
  removeTemporaryDirectory,
} from "../../lib/temporaryDirectory";

process.env.DISPLAY = process.env.DISPLAY || ":10";

const url = process.env.OVERLAY_URL || "http://127.0.0.1:7777/";
const userDataDir = createTemporaryDirectory(
  OVERLAY_TEMPORARY_DIRECTORY_PREFIX,
);
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
  .catch((err: unknown) => {
    // A failed launch must not leave the profile behind.
    removeTemporaryDirectory(userDataDir);
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

let closed = false;
const shutdown = () => {
  if (closed) return;
  closed = true;
  removeTemporaryDirectory(userDataDir);
};
context.on("close", () => {
  shutdown();
  process.exit(0);
});

// `process.on("exit")` does not run for signals, so a stopped service would
// leave the Chromium profile in the OS temp dir.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    void context
      .close()
      .catch((err) => {
        console.warn("[WARN] overlay close failed", err);
      })
      .finally(shutdown);
  });
}
await new Promise(() => {});
