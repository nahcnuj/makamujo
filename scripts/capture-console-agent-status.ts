import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { routes as consoleRoutes } from "../routes/console/index";

const ROOT_DIR = path.resolve(import.meta.dir, "..");
const DEFAULT_OUTPUT_PATH = path.join(ROOT_DIR, "var", "screenshots", "console-agent-status-mock.png");
const CONSOLE_PATH = "/console/?agentStateMock=1";

const ensureJapaneseFonts = () => {
  // `grep -q` exits with 0 when a match is found.
  const fontCheckResult = spawnSync("bash", ["-lc", "fc-list :lang=ja | grep -qi 'Noto Sans CJK'"], {
    stdio: "ignore",
  });
  if (fontCheckResult.status === 0) {
    return;
  }

  const installResult = spawnSync(
    "bash",
    ["-lc", "sudo apt-get update && sudo apt-get install -y fonts-noto-cjk"],
    { stdio: "inherit" },
  );
  if (installResult.status !== 0) {
    throw new Error("日本語フォントの導入に失敗しました。`sudo apt-get install -y fonts-noto-cjk` を実行してください。");
  }
};

const captureScreenshot = async (url: string, outputPath: string) => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByRole("heading", { name: "馬可無序" }).waitFor();
    await page.getByTestId("agent-status-mock-notice").waitFor();
    mkdirSync(path.dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, type: "png", fullPage: true });
  } finally {
    await browser.close();
  }
};

const parseOutputPath = () => {
  const outputIndex = process.argv.findIndex((arg) => arg === "--output");
  if (outputIndex === -1) {
    return DEFAULT_OUTPUT_PATH;
  }
  const value = process.argv[outputIndex + 1];
  if (!value) {
    throw new Error("--output の値が必要です。");
  }
  return path.resolve(process.cwd(), value);
};

const outputPath = parseOutputPath();
ensureJapaneseFonts();

const consolePreviewServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: consoleRoutes,
});

try {
  const screenshotURL = new URL(CONSOLE_PATH, consolePreviewServer.url).toString();
  await captureScreenshot(screenshotURL, outputPath);
  console.log(`Screenshot saved: ${outputPath}`);
} finally {
  consolePreviewServer.stop(true);
}
