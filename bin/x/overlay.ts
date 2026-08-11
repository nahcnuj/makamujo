#!/usr/bin/env bun
/**
 * Overlay browser for OBS "Comment" (XSHM left crop).
 * Geometry: 1280x720 at (0, 40) — game stays at (1280, 40).
 */
import { chromium } from "playwright";

process.env.DISPLAY = process.env.DISPLAY || ":10";

const url = process.env.OVERLAY_URL || "http://127.0.0.1:7777/";

console.log("[INFO] overlay browser DISPLAY=", process.env.DISPLAY, "url=", url);

const browser = await chromium.launch({
  headless: false,
  ignoreDefaultArgs: ["--no-startup-window"],
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=1280,720",
    "--window-position=0,40",
    "--class=MakamujoComment",
  ],
});

const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 720 });
await page.goto(url, { waitUntil: "domcontentloaded" });
console.log("[INFO] overlay loaded", page.url());

browser.on("disconnected", () => process.exit(0));
await new Promise(() => {});
