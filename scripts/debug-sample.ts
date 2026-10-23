import { chromium } from "playwright";

const WATCH_PAGE_URL = "https://live.nicovideo.jp/watch/user/14171889";

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ userAgent: "Mozilla/5.0", locale: "ja-JP", viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
await page.goto(WATCH_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
// wait ready
for (let i=0;i<30;i++) {
  const ready = await page.evaluate(() => {
    const v = document.querySelector("video");
    return !!v && v.videoWidth>0 && v.readyState>=2 && !v.paused;
  });
  if (ready) break;
  await page.waitForTimeout(1000);
  await page.evaluate(() => { for (const v of document.querySelectorAll("video")) { v.muted=false; v.volume=1; void v.play().catch(()=>{}); } });
}

const result = await page.evaluate(async () => {
  const video = document.querySelector("video") as HTMLVideoElement;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const startCt = video.currentTime;
  const scale = Math.min(1, 128 / Math.max(vw, vh));
  const width = Math.max(1, Math.round(vw * scale));
  const height = Math.max(1, Math.round(vh * scale));
  const gameWidth = Math.max(1, Math.floor(width * 0.6));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  let previous: Uint8ClampedArray | null = null;
  const samples: any[] = [];
  let changedWhole=0, changedGame=0;
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const deadline = start + 10000;
    const safety = setTimeout(resolve, 15000);
    const tick = () => {
      const now = performance.now();
      if (now >= deadline) { clearTimeout(safety); resolve(); return; }
      context.drawImage(video, 0, 0, width, height);
      const current = context.getImageData(0, 0, width, height).data;
      if (previous) {
        let wholeDiff=0, gameDiff=0; const total=width*height;
        for (let p=0;p<total;p++){const i=p*4;
          if (Math.abs((previous[i]??0)-(current[i]??0))>16 || Math.abs((previous[i+1]??0)-(current[i+1]??0))>16 || Math.abs((previous[i+2]??0)-(current[i+2]??0))>16){ wholeDiff++; if (p%width<gameWidth) gameDiff++; }
        }
        const wholeChanged = wholeDiff/total > 0.001;
        const gameChanged = gameDiff/(gameWidth*height) > 0.001;
        if (wholeChanged) changedWhole++;
        if (gameChanged) changedGame++;
        samples.push({ t: Math.round(now-start), wholeDiff, gameDiff, wholeChanged, gameChanged });
      }
      previous=current;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return { vw, vh, width, height, startCt, endCt: video.currentTime, sampleCount: samples.length, changedWhole, changedGame, firstFew: samples.slice(0,5), lastFew: samples.slice(-5) };
});
console.log(JSON.stringify(result, null, 2));

await browser.close();
