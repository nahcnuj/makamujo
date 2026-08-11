#!/usr/bin/env bun
/**
 * Overlay browser for OBS "Comment" (Window Capture).
 * Left half of :10 — does not overlap the game window (right half).
 */
import { chromium } from "playwright";

process.env.DISPLAY = process.env.DISPLAY || ":10";

const url = process.env.OVERLAY_URL || "http://127.0.0.1:7777/";

console.log("[INFO] overlay browser DISPLAY=", process.env.DISPLAY, "url=", url);

const browser = await chromium.launch({
  headless: false,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=1280,720",
    "--window-position=0,40",
    "--class=MakamujoComment",
    `--app=${url}`,
  ],
});

// Keep process alive while the window is open
browser.on("disconnected", () => process.exit(0));
await new Promise(() => {});
