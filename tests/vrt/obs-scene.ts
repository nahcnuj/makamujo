#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");
const SCENE = path.join(
  PROJECT_ROOT,
  "obs-studio",
  "basic",
  "scenes",
  "Makamujo.json",
);
const OUT_FILE = path.join(import.meta.dir, "obs-scene.png");
const GAME_URL = "https://www.nahcnuj.work/vigilant-fiesta/";
const VIEWPORT = { width: 1280, height: 720 } as const;
const LOAD_WAIT_MS = 8000;

// Validate the OBS scene: the Display Capture must be enlarged on the
// broadcast canvas.
const scene = await Bun.file(SCENE).json();
let found = false;
for (const source of scene.sources ?? []) {
  if (source.id !== "scene") continue;
  for (const item of source.settings?.items ?? []) {
    if (item.name !== "Display Capture (XSHM)") continue;
    found = true;
    for (const key of ["scale", "scale_rel"]) {
      const value = item[key] ?? {};
      if (value.x !== 2.0 || value.y !== 2.0) {
        throw new Error(`${key} must be 2.0, got ${JSON.stringify(value)}`);
      }
    }
  }
}
if (!found) {
  throw new Error("Display Capture (XSHM) item not found in OBS scene");
}

const launchBrowser = async () => {
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (executablePath) {
    return chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
  }
  try {
    return await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  } catch {
    return chromium.launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
  }
};

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: VIEWPORT });
try {
  await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(LOAD_WAIT_MS);
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  await page.screenshot({ path: OUT_FILE, type: "png" });
} finally {
  await browser.close();
}
console.log(`obs scene capture generated: ${OUT_FILE}`);
