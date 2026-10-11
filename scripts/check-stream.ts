import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const WATCH_PAGE_URL = "https://live.nicovideo.jp/watch/user/14171889";
const CHECK_DURATION_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 60_000;
const SCREENSHOT_QUALITY = 80;
const MIN_DIFF_RATIO = 0.01;

/** Left 60% of the video: game panel on the 10×8 layout. */
export const GAME_CLIP = {
  xRatio: 0,
  yRatio: 0,
  widthRatio: 0.6,
  heightRatio: 1,
} as const;

type VideoProbe = HTMLVideoElement & {
  webkitAudioDecodedByteCount?: number;
};

export interface CheckResult {
  ok: boolean;
  timestampJst: string;
  phenomena: string[];
  details: {
    audioPlaying: boolean;
    videoPlaying: boolean;
    gameScreenPlaying: boolean;
    decodedAudioBytesStart?: number;
    decodedAudioBytesEnd?: number;
    videoDiffRatio?: number;
    gameDiffRatio?: number;
    pageTitle?: string;
    pageUrl?: string;
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

export function isAudioPlaying(
  decodedBytesStart: number,
  decodedBytesEnd: number,
): boolean {
  return decodedBytesEnd > decodedBytesStart;
}

export function isPictureMoving(diffRatio: number): boolean {
  return diffRatio >= MIN_DIFF_RATIO;
}

export function isOverallOk(
  audioPlaying: boolean,
  videoPlaying: boolean,
  gameScreenPlaying: boolean,
): boolean {
  return audioPlaying && videoPlaying && gameScreenPlaying;
}

export function calculateDiffRatio(buf1: Buffer, buf2: Buffer): number {
  if (buf1.length !== buf2.length) return 1;
  let diff = 0;
  for (let i = 0; i < buf1.length; i++) {
    if (buf1[i] !== buf2[i]) diff++;
  }
  return diff / buf1.length;
}

export function clipFromBox(
  box: { x: number; y: number; width: number; height: number },
  ratios: typeof GAME_CLIP,
): { x: number; y: number; width: number; height: number } {
  return {
    x: box.x + box.width * ratios.xRatio,
    y: box.y + box.height * ratios.yRatio,
    width: box.width * ratios.widthRatio,
    height: box.height * ratios.heightRatio,
  };
}

async function screenshotClip(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<Buffer | null> {
  if (clip.width < 1 || clip.height < 1) return null;
  return page.screenshot({
    type: "jpeg",
    quality: SCREENSHOT_QUALITY,
    clip,
  });
}

async function readVideoProbe(page: Page): Promise<{
  found: boolean;
  decodedAudioBytes: number;
}> {
  return page.evaluate(() => {
    const video = document.querySelector("video") as VideoProbe | null;
    if (!video) return { found: false, decodedAudioBytes: 0 };
    return {
      found: true,
      decodedAudioBytes: video.webkitAudioDecodedByteCount ?? 0,
    };
  });
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

    await page.evaluate(() => {
      const video = document.querySelector("video");
      if (!video) return;
      video.muted = false;
      video.volume = 1;
      void video.play();
    });

    const video = await page.$("video");
    if (!video) {
      phenomena.push("ビデオ要素が見つかりません");
      return { ok: false, timestampJst, phenomena, details };
    }

    const box = await video.boundingBox();
    if (!box) {
      phenomena.push("ビデオ要素の位置を取得できません");
      return { ok: false, timestampJst, phenomena, details };
    }

    const gameClip = clipFromBox(box, GAME_CLIP);
    const startProbe = await readVideoProbe(page);
    details.decodedAudioBytesStart = startProbe.decodedAudioBytes;

    const videoStart = await screenshotClip(page, box);
    const gameStart = await screenshotClip(page, gameClip);

    await page.waitForTimeout(CHECK_DURATION_MS);

    const endProbe = await readVideoProbe(page);
    if (!endProbe.found) {
      phenomena.push("チェック中にビデオ要素が消失しました");
      return { ok: false, timestampJst, phenomena, details };
    }
    details.decodedAudioBytesEnd = endProbe.decodedAudioBytes;

    const videoEnd = await screenshotClip(page, box);
    const gameEnd = await screenshotClip(page, gameClip);

    const audioPlaying = isAudioPlaying(
      startProbe.decodedAudioBytes,
      endProbe.decodedAudioBytes,
    );
    details.audioPlaying = audioPlaying;
    if (!audioPlaying) {
      phenomena.push(
        "音声が流れていません (デコードされた音声バイトが増えません)",
      );
    } else {
      console.log(
        `[INFO] Audio playing: decoded bytes ${startProbe.decodedAudioBytes} -> ${endProbe.decodedAudioBytes}`,
      );
    }

    let videoPlaying = false;
    if (videoStart && videoEnd) {
      const videoDiffRatio = calculateDiffRatio(videoStart, videoEnd);
      details.videoDiffRatio = videoDiffRatio;
      videoPlaying = isPictureMoving(videoDiffRatio);
      if (!videoPlaying) {
        phenomena.push("映像全体が停止し続けています");
      } else {
        console.log(
          `[INFO] Video moving: diff ratio = ${(videoDiffRatio * 100).toFixed(2)}%`,
        );
      }
    } else {
      phenomena.push("映像全体のスクリーンショットを取得できませんでした");
    }
    details.videoPlaying = videoPlaying;

    let gameScreenPlaying = false;
    if (gameStart && gameEnd) {
      const gameDiffRatio = calculateDiffRatio(gameStart, gameEnd);
      details.gameDiffRatio = gameDiffRatio;
      gameScreenPlaying = isPictureMoving(gameDiffRatio);
      if (!gameScreenPlaying) {
        phenomena.push("ゲーム画面部分が停止し続けています");
      } else {
        console.log(
          `[INFO] Game screen moving: diff ratio = ${(gameDiffRatio * 100).toFixed(2)}%`,
        );
      }
    } else {
      phenomena.push(
        "ゲーム画面部分のスクリーンショットを取得できませんでした",
      );
    }
    details.gameScreenPlaying = gameScreenPlaying;

    return {
      ok: isOverallOk(audioPlaying, videoPlaying, gameScreenPlaying),
      timestampJst,
      phenomena,
      details,
    };
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
