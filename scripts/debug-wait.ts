import { chromium } from "playwright";

const WATCH_PAGE_URL = "https://live.nicovideo.jp/watch/user/14171889";

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ userAgent: "Mozilla/5.0", locale: "ja-JP", viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
await page.goto(WATCH_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
for (let i=0;i<20;i++) {
  await page.waitForTimeout(1000);
  const info = await page.evaluate(() => {
    const v = document.querySelector("video");
    return v ? { vw:v.videoWidth, vh:v.videoHeight, rs:v.readyState, paused:v.paused, ct:v.currentTime, src:(v.currentSrc||v.src||"").slice(0,60) } : null;
  });
  console.log(i+1, JSON.stringify(info), "title=", await page.title());
}
await browser.close();
