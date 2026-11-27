import { afterAll, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  applyGameScreenZoom,
  GAME_SCREEN_AREA_WIDTH,
} from "../../lib/Browser/chromium";

const GAME_SCREEN_ZOOM = 1.25;
const VRT_BASELINE_PATH = resolve(
  import.meta.dir,
  "../vrt-rtmps/baseline/capture-rtmps.png",
);
const VRT_BASELINE_DATA_URL = `data:image/png;base64,${readFileSync(VRT_BASELINE_PATH).toString("base64")}`;

const LAYOUT_PAGE = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<style>
html,body{background:#000;margin:0 auto;padding:0;overflow:hidden}
body{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;width:100%;height:auto;padding:0;margin:0 auto}
#app{margin:0 auto;max-width:40rem;width:min(100%,40rem);text-align:center}
#play-layout{display:grid;grid-template-columns:1fr;grid-template-areas:"hud" "board";justify-items:center;align-items:center;gap:0.75rem}
#hud-left{grid-area:hud;justify-self:center}
#game-container{grid-area:board;display:flex;justify-content:center;width:640px;margin:0 auto}
#game-container > canvas{width:400px;height:400px;display:inline}
.ad-slot,#ad-side-left,#ad-side-right{display:block}
</style>
</head>
<body>
<div id="app">
<main id="play-layout">
<div id="hud-left">HUD</div>
<div id="game-container"><canvas></canvas></div>
</main>
</div>
<aside class="ad-slot" id="ad-side-left">AD</aside>
</body>
</html>`;

type Rect = {
  left: number;
  right: number;
  center: number;
  display: string;
};

type Geometry = Record<"body" | "hud" | "game" | "canvas" | "ad", Rect>;

let browser: import("playwright").Browser | undefined;

try {
  const { chromium } = await import("playwright");
  browser = await Promise.race([
    chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    }),
    delay(15_000).then(() => {
      throw new Error("chromium.launch timed out after 15s");
    }),
  ]);
} catch (error) {
  console.warn(
    "[WARN] skip broadcast layout:",
    error instanceof Error ? error.message : String(error),
  );
  browser = undefined;
}

const itWithChromium = browser ? it : it.skip;

afterAll(async () => {
  await browser?.close().catch(() => {});
});

itWithChromium(
  "centers the game board inside the left game screen area at production zoom",
  async () => {
    const activeBrowser = browser;
    if (!activeBrowser) return;

    const context = await activeBrowser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    try {
      const page = await context.newPage();
      await page.setContent(LAYOUT_PAGE, { waitUntil: "load" });
      await applyGameScreenZoom(
        {
          evaluate: (fn, options) => page.evaluate(fn, options),
        },
        GAME_SCREEN_ZOOM,
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          }),
      );

      const geometry = await page.evaluate((): Geometry => {
        const rectOf = (selector: string): Rect => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`missing ${selector}`);
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            center: (rect.left + rect.right) / 2,
            display: getComputedStyle(element).display,
          };
        };
        return {
          body: rectOf("body"),
          hud: rectOf("#hud-left"),
          game: rectOf("#game-container"),
          canvas: rectOf("#game-container > canvas"),
          ad: rectOf("#ad-side-left"),
        };
      });

      expect(geometry.body.left).toBeCloseTo(0, 1);
      expect(geometry.body.right).toBeCloseTo(GAME_SCREEN_AREA_WIDTH, 1);
      expect(geometry.hud.center).toBeCloseTo(GAME_SCREEN_AREA_WIDTH / 2, 1);
      expect(geometry.game.center).toBeCloseTo(GAME_SCREEN_AREA_WIDTH / 2, 1);
      expect(geometry.canvas.center).toBeCloseTo(GAME_SCREEN_AREA_WIDTH / 2, 1);
      expect(geometry.hud.display).not.toBe("none");
      expect(geometry.ad.display).toBe("none");
    } finally {
      await context.close();
    }
  },
);

itWithChromium(
  "keeps the committed VRT baseline centered in the game screen area",
  async () => {
    const activeBrowser = browser;
    if (!activeBrowser) return;

    const context = await activeBrowser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    try {
      const page = await context.newPage();
      await page.goto(VRT_BASELINE_DATA_URL);
      const centers = await page.evaluate((gameAreaWidth: number) => {
        const image = document.querySelector("img");
        if (!(image instanceof HTMLImageElement)) {
          throw new Error("missing baseline image");
        }
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context2d = canvas.getContext("2d");
        if (!context2d) throw new Error("missing 2d context");
        context2d.drawImage(image, 0, 0);
        const pixels = context2d.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        const centerOf = (top: number, bottom: number): number => {
          let total = 0;
          let weighted = 0;
          for (let y = top; y < bottom; y++) {
            for (let x = 0; x < gameAreaWidth; x++) {
              const offset = (y * canvas.width + x) * 4;
              const red = pixels[offset] ?? 0;
              const green = pixels[offset + 1] ?? 0;
              const blue = pixels[offset + 2] ?? 0;
              const brightness = (red + green + blue) / 3;
              if (brightness < 45) continue;
              total += brightness;
              weighted += brightness * (x + 0.5);
            }
          }
          return weighted / total;
        };
        return {
          hud: centerOf(80, 350),
          board: centerOf(350, 530),
        };
      }, GAME_SCREEN_AREA_WIDTH);
      const gameCenter = GAME_SCREEN_AREA_WIDTH / 2;
      expect(centers.hud).toBeGreaterThan(gameCenter - 40);
      expect(centers.hud).toBeLessThan(gameCenter + 40);
      expect(centers.board).toBeGreaterThan(gameCenter - 40);
      expect(centers.board).toBeLessThan(gameCenter + 40);
    } finally {
      await context.close();
    }
  },
);
