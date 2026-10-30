import { afterAll, beforeAll, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createChromiumWatchPageBrowser } from "../../composition/chromiumWatchPageBrowser";
import {
  isOnAirFromClock,
  judgePictureMotion,
  type PictureMotion,
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

/** プレイヤー本体に流す MediaStream の初期化。 */
const PLAYER_SCRIPT = `
  const canvas = document.getElementById("c");
  const context = canvas.getContext("2d");
  const video = document.getElementById("v");
  video.srcObject = canvas.captureStream(30);
`;

/** 常設広告面の初期化（クロスオリジンの広告動画）。 */
const AD_SCRIPT = `
  // ページは 127.0.0.1 で配信するので、localhost は別オリジンになる。
  // クロスオリジンの広告動画というだけで広告と数えないことを見る。
  const ad = document.getElementById("ad");
  ad.src = "http://localhost:" + location.port + "/ad.webm";
  ad.play().catch(() => undefined);
`;

/** 骨格。`HEAD` にプレイヤーの初期化スクリプトを差し込む。 */
const page = (head: string): string => `<!doctype html>
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
      ${head}
      ${AD_SCRIPT}
    </script>
  </body>
</html>`;

/** 動く絵を `<video>` に流し込むページ。統計行も置いて `open` を待たせない。 */
const MOVING_PAGE = page(`${PLAYER_SCRIPT}
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
`);

/**
 * 合成出力が固まった配信のページ（issue #959）。canvas には毎フレーム同じ
 * 一枚絵を描き、`<video>` の media clock だけが進む。デコード済みフレームは
 * 増え続けるのに絵は変わらない、という本物の停止の形。
 */
const FROZEN_PAGE = page(`${PLAYER_SCRIPT}
      const draw = () => {
        context.fillStyle = "black";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "white";
        context.fillRect(40, 20, 20, 80);
        requestAnimationFrame(draw);
      };
      draw();
`);

/**
 * 開いた直後は `<video>` が無く、少し経ってからプレイヤーが要素を作る
 * ページ。広告の明けや hls.js の復帰で起きる作り直しの再現。窓を開く前に
 * 計測できる要素を待たないと、この周期は判定不能になり連続静止が途切れる。
 */
const LATE_PAGE = page(`
      const startPlayer = () => {
        ${PLAYER_SCRIPT}
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
      };
      setTimeout(startPlayer, 2_500);
`);

/**
 * プレイヤーが `<video>` を作り直し続けるページ。中割り広告の明けや hls.js
 * の復帰で起きる。作り直しのたびに media clock は 0 付近へ戻るので、窓の
 * 最初と最後の差だけを見ると「放映中」の根拠を失う。
 */
const REBUILDING_PAGE = page(`
      const canvas = document.getElementById("c");
      const context = canvas.getContext("2d");
      const stream = canvas.captureStream(30);
      let video = document.getElementById("v");
      video.srcObject = stream;
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
      setInterval(() => {
        const next = document.createElement("video");
        next.id = "v";
        next.autoplay = true;
        next.muted = true;
        next.playsInline = true;
        next.srcObject = stream;
        video.replaceWith(next);
        video = next;
      }, 1_000);
`);

let server: Server | undefined;
let port = 0;

/** Chromium がこの環境で起動できるか（skip 判定）。 */
const chromiumAvailable = await (async (): Promise<boolean> => {
  try {
    const { chromium } = await import("playwright");
    const probe = await chromium.launch({
      headless: true,
      timeout: 15_000,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
      ],
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

/** 1 ページを開いて 1 窓ぶん測り、ブラウザを捨てる。 */
const measurePage = async (path: string): Promise<PictureMotion> => {
  const browser = await createChromiumWatchPageBrowser();
  try {
    await browser.open(`http://127.0.0.1:${port}${path}`);
    const motion = await browser.measurePictureMotion?.();
    if (motion === undefined) {
      throw new Error("the browser cannot measure the picture motion");
    }
    return motion;
  } finally {
    await browser.discard();
  }
};

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
    if (req.url === "/frozen") {
      res.end(FROZEN_PAGE);
      return;
    }
    if (req.url === "/late") {
      res.end(LATE_PAGE);
      return;
    }
    if (req.url === "/rebuilding") {
      res.end(REBUILDING_PAGE);
      return;
    }
    res.end(MOVING_PAGE);
  });
  // `localhost` からも届くよう全インターフェースで待つ（ページは 127.0.0.1）。
  await new Promise<void>((resolve) => server?.listen(0, () => resolve()));
  ({ port } = server.address() as AddressInfo);
});

afterAll(() => {
  server?.close();
});

test.skipIf(!chromiumAvailable)(
  "measures the picture of a playing <video> as moving",
  async () => {
    const motion = await measurePage("/");
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
  60_000,
);

test.skipIf(!chromiumAvailable)(
  "judges a frozen picture with an advancing clock as still on air",
  async () => {
    // issue #959 の形。音声と media clock は進み、デコード済みフレームも
    // 増えるが、届く絵は変わらない。これを静止・放映中と判定できないと、
    // 本物の停止が観測から漏れる。
    const motion = await measurePage("/frozen");
    expect(motion.tainted).toBe(false);
    expect(motion.sawAdvertisement).toBe(false);
    expect(motion.comparedFrames).toBeGreaterThanOrEqual(5);
    expect(motion.changedFrames).toBeLessThanOrEqual(5);
    expect(judgePictureMotion(motion)).toBe("still");
    expect(motion.clockAdvancedSeconds).toBeGreaterThan(1);
    expect(isOnAirFromClock(motion)).toBe(true);
  },
  60_000,
);

test.skipIf(!chromiumAvailable)(
  "keeps measuring while the player rebuilds its <video>",
  async () => {
    // 開いた直後は計測できる要素が無い。開始時に空測定で打ち切ると、この
    // 周期は判定不能になり、`CompositeFreezePolicy` が連続静止を数え直す。
    const motion = await measurePage("/late");
    expect(motion.tainted).toBe(false);
    expect(motion.comparedFrames).toBeGreaterThanOrEqual(5);
    expect(motion.changedFrames).toBeGreaterThan(0);
    expect(judgePictureMotion(motion)).toBe("moving");
    expect(isOnAirFromClock(motion)).toBe(true);
  },
  60_000,
);

test.skipIf(!chromiumAvailable)(
  "keeps the on-air clock while the player rebuilds mid-window",
  async () => {
    // 作り直しで media clock が 0 付近に戻っても、要素ごとの前進を足し上げて
    // 「放映中」と判定できること。単純な最後と最初の差だと負になり、停止が
    // 続いているのに放映外（= 判定不能）として捨てられる。
    const motion = await measurePage("/rebuilding");
    expect(motion.tainted).toBe(false);
    expect(motion.comparedFrames).toBeGreaterThanOrEqual(5);
    expect(motion.changedFrames).toBeGreaterThan(0);
    expect(judgePictureMotion(motion)).toBe("moving");
    expect(motion.clockAdvancedSeconds).toBeGreaterThan(1);
    expect(isOnAirFromClock(motion)).toBe(true);
  },
  60_000,
);
