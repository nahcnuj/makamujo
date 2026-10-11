import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const WATCH_PAGE_URL = "https://live.nicovideo.jp/watch/user/14171889";
const CHECK_DURATION_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 60_000;
const SCREENSHOT_QUALITY = 80;
const MIN_DIFF_RATIO = 0.01;

export interface CheckResult {
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
    videoVolume?: number;
    hasAudioTracks?: boolean;
    pageTitle?: string;
    pageUrl?: string;
    videoRegionDiffRatio?: number;
  };
}

export function formatJst(date: Date): string {
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

export function isVideoPlaying(
  _initialPaused: boolean,
  initialCurrentTime: number,
  finalPaused: boolean,
  finalCurrentTime: number,
): boolean {
  if (finalPaused) return false;
  const timeAdvanced = finalCurrentTime - initialCurrentTime;
  const expectedAdvance = CHECK_DURATION_MS / 1000;
  const tolerance = 2;
  return timeAdvanced >= expectedAdvance - tolerance;
}

export function isAudioPlaying(
  videoPlaying: boolean,
  muted: boolean,
  volume: number,
  hasAudioTracks: boolean,
): boolean {
  return videoPlaying && !muted && volume > 0 && hasAudioTracks;
}

export function isOverallOk(
  audioPlaying: boolean,
  videoPlaying: boolean,
  gameScreenPlaying: boolean,
): boolean {
  return audioPlaying && videoPlaying && gameScreenPlaying;
}

export async function takeVideoRegionScreenshot(
  page: import("playwright").Page,
): Promise<Buffer | null> {
  const video = await page.$("video");
  if (!video) return null;
  return video.screenshot({ type: "jpeg", quality: SCREENSHOT_QUALITY });
}

export function calculateDiffRatio(buf1: Buffer, buf2: Buffer): number {
  if (buf1.length !== buf2.length) return 1;
  let diff = 0;
  for (let i = 0; i < buf1.length; i++) {
    if (buf1[i] !== buf2[i]) diff++;
  }
  return diff / buf1.length;
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

    await page.waitForSelector("video", { timeout: 15_000 });

    const initialVideoState = await page.evaluate(() => {
      const video = document.querySelector("video") as HTMLVideoElement & {
        audioTracks?: { length: number };
      };
      if (!video) return { found: false };
      return {
        found: true,
        currentTime: video.currentTime,
        paused: video.paused,
        muted: video.muted,
        volume: video.volume,
        audioTracks: video.audioTracks?.length ?? 0,
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
    details.videoVolume = initialVideoState.volume;
    details.hasAudioTracks = (initialVideoState.audioTracks ?? 0) > 0;

    console.log(
      `[INFO] Initial video state: currentTime=${initialVideoState.currentTime}, paused=${initialVideoState.paused}, muted=${initialVideoState.muted}, volume=${initialVideoState.volume}, audioTracks=${initialVideoState.audioTracks}, readyState=${initialVideoState.readyState}`,
    );

    const videoRegionStart = await takeVideoRegionScreenshot(page);

    await page.waitForTimeout(CHECK_DURATION_MS);

    const finalVideoState = await page.evaluate(() => {
      const video = document.querySelector("video") as HTMLVideoElement & {
        audioTracks?: { length: number };
      };
      if (!video) return { found: false };
      return {
        found: true,
        currentTime: video.currentTime,
        paused: video.paused,
        muted: video.muted,
        volume: video.volume,
        audioTracks: video.audioTracks?.length ?? 0,
        readyState: video.readyState,
        ended: video.ended,
      };
    });

    if (!finalVideoState.found) {
      phenomena.push("チェック中にビデオ要素が消失しました");
      return { ok: false, timestampJst, phenomena, details };
    }

    const startTime = initialVideoState.currentTime ?? 0;
    const endTime = finalVideoState.currentTime ?? 0;
    details.videoCurrentTimeEnd = endTime;

    const videoPlaying = isVideoPlaying(
      initialVideoState.paused ?? false,
      startTime,
      finalVideoState.paused ?? false,
      endTime,
    );

    if (!videoPlaying) {
      if (finalVideoState.paused) {
        phenomena.push("ビデオが一時停止状態です");
      } else {
        const timeAdvanced = endTime - startTime;
        const expectedAdvance = CHECK_DURATION_MS / 1000;
        phenomena.push(
          `ビデオが停止している可能性があります (currentTime 進捗: ${timeAdvanced.toFixed(1)}秒 / 期待: ~${expectedAdvance}秒)`,
        );
      }
    } else {
      console.log(
        `[INFO] Video playing: currentTime advanced from ${startTime.toFixed(1)} to ${endTime.toFixed(1)} (Δ${(endTime - startTime).toFixed(1)}s)`,
      );
    }
    details.videoPlaying = videoPlaying;

    const audioPlaying = isAudioPlaying(
      videoPlaying,
      finalVideoState.muted ?? false,
      finalVideoState.volume ?? 0,
      (finalVideoState.audioTracks ?? 0) > 0,
    );
    if (!audioPlaying) {
      if (finalVideoState.muted) {
        phenomena.push("ビデオがミュートされています");
      } else if (finalVideoState.volume === 0) {
        phenomena.push("ビデオの音量が 0 です");
      } else if (finalVideoState.audioTracks === 0) {
        phenomena.push("音声トラックがありません");
      } else {
        phenomena.push("音声が再生されていない可能性があります");
      }
    } else {
      console.log(
        "[INFO] Audio likely playing (video playing, not muted, volume > 0, has audio tracks)",
      );
    }
    details.audioPlaying = audioPlaying;

    const videoRegionEnd = await takeVideoRegionScreenshot(page);

    let gameScreenPlaying = false;
    if (videoRegionStart && videoRegionEnd) {
      const videoRegionDiffRatio = calculateDiffRatio(
        videoRegionStart,
        videoRegionEnd,
      );
      details.videoRegionDiffRatio = videoRegionDiffRatio;

      if (videoRegionDiffRatio < MIN_DIFF_RATIO) {
        phenomena.push(
          "ゲーム画面部分が停止している可能性があります (動画領域の変化が検出されません)",
        );
      } else {
        console.log(
          `[INFO] Video region changed: diff ratio = ${(videoRegionDiffRatio * 100).toFixed(2)}%`,
        );
        gameScreenPlaying = true;
      }
    } else {
      phenomena.push(
        "ゲーム画面部分のスクリーンショットを取得できませんでした",
      );
    }
    details.gameScreenPlaying = gameScreenPlaying;

    const ok = isOverallOk(audioPlaying, videoPlaying, gameScreenPlaying);

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

  const outputPath = join(process.cwd(), "stream-check-result.json");
  writeFileSync(outputPath, JSON.stringify(result));
  console.log(`[INFO] Result written to ${outputPath}`);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[ERROR] Stream check failed:", error);
    process.exitCode = 1;
  });
}
