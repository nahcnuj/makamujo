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
 * ページにはプレイヤーの外側の常設広告面（`___ad-sticky-video___`、クロス
 * オリジンで再生し続ける広告動画）も置く。これを広告と数えると測定は毎窓
 * `sawAdvertisement` になり、合成出力が固まっていても回復ラングが一度も走ら
 * ない（issue #946）。番組が動いていれば広告が隣で流れていても `moving` と
 * 判定できることを見る。
 *
 * Chromium が起動できない環境では skip する。
 */

/**
 * 常設広告面に流す広告動画（32x32 の VP8 WebM、約 700 バイト）。
 * クロスオリジンで再生させるためだけのもの。
 */
const STICKY_AD_WEBM_BASE64 =
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAKcEU2bdLlNu4tTq4QVSalmU6yBbk27i1OrhBZU" +
  "rmtTrIGTTbuLU6uEH0O2dVOsgdRNu4xTq4QcU7trU6yCAorsrgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAVSalmoCrXsYMPQkBEiYRD+9YETYCGQ2hyb21lV0GGQ2hyb21lFlSua7yuuteBAXPFh0nUnWTK21iDgQFV7oEBhoVW" +
  "X1ZQOOCdsIEguoEgU8CBAVWwkFWxgQFVuYECVbqBDVW7gQEfQ7Z1AQAAAAAAAarngQCg7KG/gQAAAPACAJ0BKiAAIAAABwiFhYiZ" +
  "hIgBJBATrVAfwBBBCUzzgP7/p3k//8nu/8nu/8nu//ye7/87BsS7XgAAdaGopqbugQGloVACAJ0BKiAAIAAABwiFhYiZhIgBJBAA" +
  "PIeeTgD+/7qDAKDRobCBAGcAEQIAABAJIADAOcBBC9OWagJEMP7+67y/+U9jivo/8p+//5PdnjSmiX/5OAB1oZmml+6BAaWS0QEA" +
  "ABAJIADAAMLBf6AAQ4AA+4EAoLehloEAywDRAQAAEAkgAMAAwsF/oABDgAB1oZmml+6BAaWS0QEAABAJIADAAMLBf6AAQ4AA+4Fn" +
  "oLehloEBLwDRAQAAEAkgAMAAwsF/oABDgAB1oZmml+6BAaWS0QEAABAJIADAAMLBf6AAQ4AA+4HLoLihloEBkwDRAQAAEAkgAMAA" +
  "wsF/oABDgAB1oZmml+6BAaWS0QEAABAJIADAAMLBf6AAQ4AA+4IBL6C4oZaBAfcA0QEAABAJIADAAMLBf6AAQ4AAdaGZppfugQGl" +
  "ktEBAAAQCSAAwADCwX+gAEOAAPuCAZMcU7trjbuLs4EAt4b3gQHxgdQ=";

/** 動く絵を `<video>` に流し込むページ。統計行も置いて `open` を待たせない。 */
const PAGE = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>picture motion</title></head>
  <body>
    <div class="watch-count-item"><span data-blank="false">0</span></div>
    <canvas id="c" width="160" height="120"></canvas>
    <video id="v" autoplay muted playsinline></video>
    <aside class="___ad-sticky-video___KZcuJ">
      <video id="ad" autoplay muted loop playsinline></video>
    </aside>
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

      // ページは 127.0.0.1 で配信するので、localhost は別オリジンになる。
      // クロスオリジンの広告動画というだけで広告と数えないことを見る。
      const ad = document.getElementById("ad");
      ad.src = "http://localhost:" + location.port + "/ad.webm";
      ad.play().catch(() => undefined);
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
  server = createServer((req, res) => {
    if (req.url === "/ad.webm") {
      res.writeHead(200, { "content-type": "video/webm" });
      res.end(Buffer.from(STICKY_AD_WEBM_BASE64, "base64"));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  // `localhost` からも届くよう全インターフェースで待つ（ページは 127.0.0.1）。
  await new Promise<void>((resolve) => server?.listen(0, () => resolve()));
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
