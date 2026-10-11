import { chromium } from "playwright";

const WATCH_PAGE_URL = "https://live.nicovideo.jp/watch/user/14171889";
const CHECK_DURATION_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 60_000;

interface CheckResult {
  ok: boolean;
  timestampJst: string;
  phenomena: string[];
  details: {
    audioPlaying: boolean;
    videoPlaying: boolean;
    gameScreenPlaying: boolean;
    videoCurrentTimeStart?: number;
    videoCurrentTimeEnd?: number;
    videoPaused?: boolean;
    videoMuted?: boolean;
    pageTitle?: string;
    pageUrl?: string;
  };
}

function formatJst(date: Date): string {
  return date
    .toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    .replace(/\//g, "-");
}

async function checkStream(): Promise<CheckResult> {
  const timestampJst = formatJst(new Date());
  const phenomena: string[] = [];
  const details: CheckResult["details"] = {
    audioPlaying: false,
    videoPlaying: false,
    gameScreenPlaying: false,
  };

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
    viewport: { width: 1600, height: 900 },
  });

  const page = await context.newPage();

  try {
    console.log(`[INFO] Opening watch page: ${WATCH_PAGE_URL}`);
    const response = await page.goto(WATCH_PAGE_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    console.log(
      `[INFO] Watch page opened (status=${response?.status() ?? "unknown"}, url=${page.url()})`,
    );

    details.pageTitle = await page.title().catch(() => "");
    details.pageUrl = page.url();

    // Wait for the video element to be present
    await page.waitForSelector("video", { timeout: 15_000 });

    // Get initial video state
    const initialVideoState = await page.evaluate(() => {
      const video = document.querySelector("video");
      if (!video) return { found: false };
      return {
        found: true,
        currentTime: video.currentTime,
        paused: video.paused,
        muted: video.muted,
        readyState: video.readyState,
        ended: video.ended,
      };
    });

    if (!initialVideoState.found) {
      phenomena.push("ビデオ要素が見つかりません");
      return { ok: false, timestampJst, phenomena, details };
    }

    details.videoCurrentTimeStart = initialVideoState.currentTime;
    details.videoPaused = initialVideoState.paused;
    details.videoMuted = initialVideoState.muted;

    console.log(
      `[INFO] Initial video state: currentTime=${initialVideoState.currentTime}, paused=${initialVideoState.paused}, muted=${initialVideoState.muted}, readyState=${initialVideoState.readyState}`,
    );

    // Wait for CHECK_DURATION_MS to observe playback
    await page.waitForTimeout(CHECK_DURATION_MS);

    // Get final video state
    const finalVideoState = await page.evaluate(() => {
      const video = document.querySelector("video");
      if (!video) return { found: false };
      return {
        found: true,
        currentTime: video.currentTime,
        paused: video.paused,
        muted: video.muted,
        readyState: video.readyState,
        ended: video.ended,
      };
    });

    if (!finalVideoState.found) {
      phenomena.push("チェック中にビデオ要素が消失しました");
      return { ok: false, timestampJst, phenomena, details };
    }

    details.videoCurrentTimeEnd = finalVideoState.currentTime;

    // Check video playing: not paused and currentTime advanced
    const startTime = initialVideoState.currentTime ?? 0;
    const endTime = finalVideoState.currentTime ?? 0;
    const timeAdvanced = endTime - startTime;
    const expectedAdvance = CHECK_DURATION_MS / 1000; // ~10 seconds
    const tolerance = 2; // allow 2 seconds tolerance

    const videoPlaying =
      !finalVideoState.paused && timeAdvanced >= expectedAdvance - tolerance;

    if (!videoPlaying) {
      if (finalVideoState.paused) {
        phenomena.push("ビデオが一時停止状態です");
      } else {
        phenomena.push(
          `ビデオが停止している可能性があります (currentTime 進捗: ${timeAdvanced.toFixed(1)}秒 / 期待: ~${expectedAdvance}秒)`,
        );
      }
    } else {
      console.log(
        `[INFO] Video playing: currentTime advanced from ${startTime.toFixed(1)} to ${endTime.toFixed(1)} (Δ${timeAdvanced.toFixed(1)}s)`,
      );
    }
    details.videoPlaying = videoPlaying;

    // Check audio: not muted and video is playing
    const audioPlaying = !finalVideoState.muted && videoPlaying;
    if (!audioPlaying) {
      if (finalVideoState.muted) {
        phenomena.push("ビデオがミュートされています");
      } else {
        phenomena.push("音声が再生されていない可能性があります");
      }
    } else {
      console.log("[INFO] Audio likely playing (video playing and not muted)");
    }
    details.audioPlaying = audioPlaying;

    // Game screen check: same as video playing for now
    details.gameScreenPlaying = videoPlaying;
    if (!videoPlaying) {
      phenomena.push("ゲーム画面部分が停止している可能性があります");
    }

    const ok =
      details.audioPlaying && details.videoPlaying && details.gameScreenPlaying;

    return { ok, timestampJst, phenomena, details };
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("[INFO] Starting stream health check...");
  const result = await checkStream();

  console.log(`[RESULT] ok=${result.ok}`);
  console.log(`[RESULT] timestampJst=${result.timestampJst}`);
  console.log(`[RESULT] phenomena=${JSON.stringify(result.phenomena)}`);
  console.log(`[RESULT] details=${JSON.stringify(result.details)}`);

  // Output JSON for GitHub Actions to parse (using GITHUB_OUTPUT with heredoc for multiline safety)
  const output = JSON.stringify(result);
  console.log(`result=${output}`);
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, "result<<EOF\n");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, "EOF\n");
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[ERROR] Stream check failed:", error);
  process.exitCode = 1;
});
