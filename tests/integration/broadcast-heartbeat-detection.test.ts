import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createChromiumWatchPageBrowser } from "../../composition/chromiumWatchPageBrowser";
import {
  judgePictureMotion,
  type PictureMotion,
} from "../../composition/watchPageBrowser";

/**
 * 鼓動の帯（`src/components/BroadcastHeartbeat.tsx`）が、外からの配信異常検知
 * （`scripts/check-stream.ts` の閾値: 標本最大 128px、チャンネル許容 16、変化率
 * 0.001、`VIDEO_MIN_FPS = 24`）で「動いている」と数えられることの統合テスト
 * （issue #1007: 静止しているゲーム画面に帯を重ねた合成出力が、10 秒窓で
 * 変化フレーム 0 として検知された）。
 *
 * 合成出力は OBS が CEF のオーバーレイを XSHM キャプチャの上に焼き込んだもの
 * で、観測側は絵そのものだけを見る。ここではそこへ届く絵を canvas に描いて
 * `<video>`（30fps）に流し、検知と同じ骨格・同じ閾値の `measurePictureMotion`
 * で測る。背景は濃い画面と明るい画面の双方: 背景が帯と同じ明るさのとき差が
 * 許容を割って帯だけの動きが消えると、静止しているゲーム画面が再び検知に出る。
 *
 * Chromium が起動できない環境では skip する。
 */

const here = dirname(fileURLToPath(import.meta.url));

let server: Server | undefined;
let port = 0;

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
      "[TEST DIAG] chromium unavailable; band detection test will be skipped:",
      error instanceof Error ? error.message.split("\n")[0] : String(error),
    );
    return false;
  }
})();

/**
 * 静止したゲーム画面に鼓動の帯を焼き込むページ。`src/index.css` の
 * `broadcast-heartbeat-sweep`（translateY -12vh → 112vh）と
 * `.broadcast-heartbeat` の背景（rgba(0,0,0,.5) → rgba(255,255,255,.5) →
 * rgba(0,0,0,.5)）をそのまま canvas へ焼く。
 */
const pageOf = (bg: string): string => {
  const body = [
    "const canvas = document.getElementById('c');",
    "const context = canvas.getContext('2d');",
    "const video = document.getElementById('v');",
    "video.srcObject = canvas.captureStream(30);",
    `const W = canvas.width, H = canvas.height;`,
    `const SWEEP_DURATION_MS = 600;`,
    `const SWEEP_FROM_VH = -12;`,
    `const SWEEP_SPAN_VH = 124;`,
    "const bandHeight = (6 / 100) * H;",
    "const startedAt = performance.now();",
    "const colorAt = (f) => {",
    "  if (f <= 0.5) {",
    `    const t = f / 0.5;`,
    "    return [Math.round(255 * t), Math.round(255 * t), Math.round(255 * t), 0.5];",
    "  }",
    `  const t = (f - 0.5) / 0.5;`,
    "  return [Math.round(255 * (1 - t)), Math.round(255 * (1 - t)), Math.round(255 * (1 - t)), 0.5];",
    "};",
    "const draw = () => {",
    "  const elapsed = performance.now() - startedAt;",
    "  context.fillStyle = " +
      (bg === "white" ? "'#f5f5f0'" : "'#05070d'") +
      ";",
    "  context.fillRect(0, 0, W, H);",
    "  context.fillStyle = " +
      (bg === "white" ? "'#d8d8cf'" : "'#12182b'") +
      ";",
    "  context.fillRect(0, H - 60, W, 60);",
    "  context.fillStyle = " +
      (bg === "white" ? "'#b4b4a8'" : "'#262f4d'") +
      ";",
    "  context.fillRect(20, 40, 120, 30);",
    "  const phase = (elapsed % SWEEP_DURATION_MS) / SWEEP_DURATION_MS;",
    "  const top = (SWEEP_FROM_VH + SWEEP_SPAN_VH * phase) / 100 * H;",
    "  const y0 = Math.max(0, Math.ceil(top));",
    "  const y1 = Math.min(H - 1, Math.floor(top + bandHeight));",
    "  for (let y = y0; y <= y1; y++) {",
    "    const f = (y - top) / bandHeight;",
    "    if (f < 0 || f > 1) continue;",
    "    const color = colorAt(f);",
    "    context.fillStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + color[3] + ')';",
    "    context.fillRect(0, y, W, 1);",
    "  }",
    "  requestAnimationFrame(draw);",
    "};",
    "draw();",
  ].join("\n");
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>band detection</title></head>
  <body>
    <div class="watch-count-item"><span data-blank="false">0</span></div>
    <canvas id="c" width="1280" height="720"></canvas>
    <video id="v" autoplay muted playsinline></video>
    <script>
      ${body}
    </script>
  </body>
</html>`;
};

beforeAll(async () => {
  if (!chromiumAvailable) {
    return;
  }
  server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const bg = req.url?.includes("bg=white") ? "white" : "dark";
    res.end(pageOf(bg));
  });
  await new Promise<void>((resolve) => server?.listen(0, () => resolve()));
  ({ port } = server.address() as AddressInfo);
});

afterAll(() => {
  server?.close();
});

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

const detectCases: ReadonlyArray<{ label: string; bg: string }> = [
  { label: "dark", bg: "dark" },
  { label: "light", bg: "white" },
];

for (const { label, bg } of detectCases) {
  test.skipIf(!chromiumAvailable)(
    `keeps the still ${label} scene detectable while the heartbeat sweeps`,
    async () => {
      // 鼓動の実装（src/index.css）が壊れると本件と同じ停止を起こすので、
      // CSS の宣言がこのテストの前提と離れていないことも押さえる。
      const css = readFileSync(
        join(here, "..", "..", "src", "index.css"),
        "utf8",
      );
      expect(css).toMatch(
        /animation:\s*broadcast-heartbeat-sweep\s+0\.6s\s+linear\s+infinite/,
      );
      const motion = await measurePage(`/band?bg=${bg}`);
      expect(motion.tainted).toBe(false);
      expect(motion.sawAdvertisement).toBe(false);
      // 30fps の窓で検知の閾値 (24) を超える変化レートが保たれること。
      // 1 提示フレームでの帯の反転（≈6.9vh > 6vh）は理論上限 ≈30fps に近い。
      const changedFps = motion.changedFrames / (motion.windowMs / 1000);
      expect(changedFps).toBeGreaterThan(26);
      expect(judgePictureMotion(motion)).toBe("moving");
      expect(motion.clockAdvancedSeconds).toBeGreaterThan(1);
    },
    60_000,
  );
}
