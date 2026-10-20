import { afterAll, beforeAll, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createChromiumWatchPageBrowser } from "../../composition/chromiumWatchPageBrowser";
import {
  isOnAirFromClock,
  judgePictureMotion,
  type PictureMotion,
  type WatchPageBrowser,
} from "../../composition/watchPageBrowser";

/**
 * 配信映像の動きの測定が、実際に再生している `<video>` を対象にできることの
 * 統合テスト。
 *
 * 統計用ブラウザは headless で動く。起動フラグ
 * (`--autoplay-policy=no-user-gesture-required`) と `startVideoPlayback` の
 * 再生促進が無いと `<video>` は paused のままになり、サンプラーは比較対象を
 * 選べず、配信が本当に固まっていても観測は永久に `unknown` になる。すると
 * 配信画面の停止回復（`broadcastFreezeWatchdog`）が一度も走らない。
 *
 * ここではローカルページの `<video>` に canvas の MediaStream を流し、
 * ページが実際に動く絵を提示していれば changed fps が記録されることを見る。
 *
 * Chromium が起動できない環境では skip する。
 */

/** 動く絵を `<video>` に流し込むページ。統計行も置いて `open` を待たせない。 */
const PAGE = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>picture motion</title></head>
  <body>
    <div class="watch-count-item"><span data-blank="false">0</span></div>
    <canvas id="c" width="160" height="120"></canvas>
    <video id="v" autoplay muted playsinline></video>
    <script>
      const canvas = document.getElementById("c");
      const context = canvas.getContext("2d");
      const video = document.getElementById("v");
      video.srcObject = canvas.captureStream(30);
      let tick = 0;
      const draw = () => {
        context.fillStyle = "black";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "white";
        context.fillRect((tick * 7) % 140, 20, 20, 80);
        tick += 1;
        requestAnimationFrame(draw);
      };
      draw();
    </script>
  </body>
</html>`;

let server: Server | undefined;
let browser: WatchPageBrowser | undefined;
let motion: PictureMotion | undefined;

/** Chromium がこの環境で起動できるか（skip 判定）。 */
const chromiumAvailable = await (async (): Promise<boolean> => {
  try {
    const { chromium } = await import("playwright");
    const probe = await chromium.launch({
      headless: true,
      timeout: 60_000,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    await probe.close();
    return true;
  } catch (error) {
    console.warn(
      "[TEST DIAG] chromium unavailable; picture motion integration test will be skipped:",
      error instanceof Error ? error.message.split("\n")[0] : String(error),
    );
    return false;
  }
})();

beforeAll(async () => {
  if (!chromiumAvailable) {
    return;
  }
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) =>
    server?.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  browser = await createChromiumWatchPageBrowser();
  await browser.open(`http://127.0.0.1:${port}/`);
  motion = await browser.measurePictureMotion?.();
}, 60_000);

afterAll(async () => {
  await browser?.discard();
  server?.close();
});

test.skipIf(!chromiumAvailable)(
  "measures the picture of a playing <video> as moving",
  () => {
    if (motion === undefined) {
      throw new Error("the picture motion was not measured");
    }
    expect(motion.tainted).toBe(false);
    expect(motion.sawAdvertisement).toBe(false);
    expect(motion.windowMs).toBeGreaterThanOrEqual(1_000);
    // 30fps の動く絵なので、比較も変化も十分にある。
    expect(motion.comparedFrames).toBeGreaterThanOrEqual(5);
    expect(motion.changedFrames).toBeGreaterThan(0);
    expect(judgePictureMotion(motion)).toBe("moving");
    // 再生中の `<video>` は media clock が進む。放映中の根拠はこの前進で取る。
    expect(motion.clockAdvancedSeconds).toBeGreaterThan(1);
    expect(isOnAirFromClock(motion)).toBe(true);
  },
);
