import { chromium } from "playwright";

const WATCH_PAGE_URL = "https://live.nicovideo.jp/watch/user/14171889";

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ userAgent: "Mozilla/5.0", locale: "ja-JP", viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
await page.goto(WATCH_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("video", { timeout: 30000 });
await page.waitForTimeout(10000);

const info = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("video")).map((v, i) => ({
    i,
    className: v.className,
    id: v.id,
    currentSrc: (v.currentSrc || v.src || "").slice(0, 80),
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
    readyState: v.readyState,
    paused: v.paused,
    currentTime: v.currentTime,
    muted: v.muted,
  }));
});
console.log("VIDEOS", JSON.stringify(info, null, 2));

await browser.close();
