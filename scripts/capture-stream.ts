import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT_DIR = path.resolve(import.meta.dir, "..");
const DEFAULT_OUTPUT_PATH = path.join(
  ROOT_DIR,
  "tests",
  "fixtures",
  "vrt-screenshots",
  "stream-capture.png",
);
const GAME_URL = "https://www.nahcnuj.work/vigilant-fiesta/";
const VIEWPORT = { width: 1280, height: 720 } as const;
const LOAD_WAIT_MS = 8000;

const parseOutputPath = (): string => {
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex === -1) {
    return DEFAULT_OUTPUT_PATH;
  }
  const value = process.argv[outputIndex + 1];
  if (!value) {
    throw new Error("--output の値が必要です。");
  }
  return path.resolve(process.cwd(), value);
};

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

const capture = async (outputPath: string): Promise<void> => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    await page.goto(GAME_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(LOAD_WAIT_MS);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, type: "png" });
  } finally {
    await browser.close();
  }
  console.log(`stream capture generated: ${outputPath}`);
};

await capture(parseOutputPath());
