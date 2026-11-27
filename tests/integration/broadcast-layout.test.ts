import { afterAll, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  applyGameScreenZoom,
  GAME_SCREEN_AREA_WIDTH,
} from "../../lib/Browser/chromium";

const GAME_SCREEN_ZOOM = 1.25;
const GAME_CENTER = GAME_SCREEN_AREA_WIDTH / 2;
const VRT_BASELINE_PATH = resolve(
  import.meta.dir,
  "../vrt-rtmps/baseline/capture-rtmps.png",
);
const VRT_BASELINE_DATA_URL = `data:image/png;base64,${readFileSync(VRT_BASELINE_PATH).toString("base64")}`;

const GAME_PAGE = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; }
html,body{margin:0;padding:0;min-height:100vh;background:#0f1419;color:#fff;font-family:system-ui,sans-serif}
body{display:flex;align-items:flex-start;justify-content:center;padding:0.75rem}
#app{margin:0 auto;width:min(100%,40rem);position:relative}
#site-header{text-align:center;margin-bottom:0.75rem}
#site-title{margin:0;font-size:1.6rem}
.screen{text-align:center;padding:0.5rem 0 1rem}
.screen.hidden,.screen[hidden]{display:none!important}
#screen-playing{padding:0;text-align:left;position:relative;margin-bottom:1.25rem;touch-action:none}
#play-layout{display:grid;grid-template-columns:1fr;grid-template-areas:"hud" "board";gap:0.75rem;justify-items:center}
#hud-left{grid-area:hud;width:min(100%,22rem);display:flex;flex-direction:row;flex-wrap:wrap;align-items:stretch;justify-content:center;gap:0.5rem}
#hud-left > div{background:#ff0000;padding:0.55rem 0.75rem;border-radius:0.75rem}
#game-container{grid-area:board;justify-self:center;background:#1a222c;border-radius:8px;overflow:hidden;line-height:0}
.ad-gutter,.ad-slot{width:160px;min-height:100vh;background:#000}
</style>
</head>
<body>
<aside id="ad-side-left" class="ad-gutter ad-slot">AD</aside>
<div id="app">
<header id="site-header"><h1 id="site-title">Mathch-Three</h1></header>
<section id="screen-title" class="screen" data-screen="title">
<button type="button" id="btn-start">スタート</button>
</section>
<section id="screen-playing" class="screen hidden" data-screen="playing" hidden>
<main id="play-layout">
<aside id="hud-left" aria-label="スコア">
<div id="overlay">Score: 0</div>
<div id="next-panel">Next</div>
</aside>
<div id="game-container"><canvas id="game-board" width="400" height="400"></canvas></div>
</main>
</section>
</div>
<aside id="ad-side-right" class="ad-gutter ad-slot">AD</aside>
<script>
document.getElementById("btn-start").addEventListener("click", () => {
  const title = document.getElementById("screen-title");
  const playing = document.getElementById("screen-playing");
  const canvas = document.getElementById("game-board");
  title.hidden = true;
  title.classList.add("hidden");
  playing.hidden = false;
  playing.classList.remove("hidden");
  const context = canvas.getContext("2d");
  context.fillStyle = "#0000ff";
  context.fillRect(0, 0, canvas.width, canvas.height);
});
</script>
</body>
</html>`;

type Rect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  center: number;
  display: string;
};

type Geometry = {
  hud: Rect;
  overlay: Rect;
  nextPanel: Rect;
  game: Rect;
  canvas: Rect;
  ad: Rect;
};

type PixelKind = "hud" | "board";
type PixelCenters = {
  hud: number;
  board: number;
  hudBounds: number;
  boardBounds: number;
};

let browser: import("playwright").Browser | undefined;

try {
  const { chromium } = await import("playwright");
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH?.trim();
  browser = await Promise.race([
    chromium.launch({
      headless: true,
      executablePath: executablePath || undefined,
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

const measurePixelCenters = async (
  context: import("playwright").BrowserContext,
  png: Uint8Array,
): Promise<PixelCenters> => {
  const page = await context.newPage();
  try {
    await page.goto(
      `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
    );
    return await page.evaluate((areaWidth: number) => {
      const image = document.querySelector("img");
      if (!(image instanceof HTMLImageElement)) {
        throw new Error("missing screenshot image");
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
      const measure = (kind: PixelKind) => {
        let total = 0;
        let weighted = 0;
        let left = areaWidth;
        let right = -1;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < areaWidth; x++) {
            const offset = (y * canvas.width + x) * 4;
            const red = pixels[offset] ?? 0;
            const green = pixels[offset + 1] ?? 0;
            const blue = pixels[offset + 2] ?? 0;
            const matches =
              kind === "hud"
                ? red > 200 && green < 80 && blue < 80
                : blue > 200 && red < 80 && green < 80;
            if (!matches) continue;
            total += 1;
            weighted += x + 0.5;
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
        }
        if (total === 0) throw new Error(`missing ${kind} pixels`);
        return { center: weighted / total, bounds: (left + right + 1) / 2 };
      };
      const hud = measure("hud");
      const board = measure("board");
      return {
        hud: hud.center,
        board: board.center,
        hudBounds: hud.bounds,
        boardBounds: board.bounds,
      };
    }, GAME_SCREEN_AREA_WIDTH);
  } finally {
    await page.close();
  }
};

itWithChromium(
  "keeps the HUD visible above a board centered at production zoom",
  async () => {
    const activeBrowser = browser;
    if (!activeBrowser) return;

    const context = await activeBrowser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    try {
      const page = await context.newPage();
      await page.setContent(GAME_PAGE, { waitUntil: "load" });
      await applyGameScreenZoom(
        { evaluate: (fn, options) => page.evaluate(fn, options) },
        GAME_SCREEN_ZOOM,
      );

      const title = await page.evaluate((): Rect => {
        const element = document.querySelector("#site-header");
        if (!element) throw new Error("missing #site-header");
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          center: (rect.left + rect.right) / 2,
          display: getComputedStyle(element).display,
        };
      });
      expect(title.display).not.toBe("none");
      expect(title.center).toBeCloseTo(GAME_CENTER, 1);

      await page.click("#btn-start");
      await applyGameScreenZoom(
        { evaluate: (fn, options) => page.evaluate(fn, options) },
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
            top: rect.top,
            bottom: rect.bottom,
            center: (rect.left + rect.right) / 2,
            display: getComputedStyle(element).display,
          };
        };
        return {
          hud: rectOf("#hud-left"),
          overlay: rectOf("#overlay"),
          nextPanel: rectOf("#next-panel"),
          game: rectOf("#game-container"),
          canvas: rectOf("#game-board"),
          ad: rectOf("#ad-side-left"),
        };
      });

      expect(geometry.hud.display).not.toBe("none");
      expect(geometry.overlay.display).not.toBe("none");
      expect(geometry.nextPanel.display).not.toBe("none");
      expect(geometry.canvas.display).not.toBe("none");
      expect(geometry.ad.display).toBe("none");
      expect(geometry.hud.bottom).toBeLessThan(geometry.game.top);
      expect(geometry.overlay.bottom).toBeLessThan(geometry.game.top);
      expect(geometry.nextPanel.bottom).toBeLessThan(geometry.game.top);
      for (const rect of [geometry.hud, geometry.game, geometry.canvas]) {
        expect(rect.center).toBeCloseTo(GAME_CENTER, 1);
        expect(rect.right).toBeLessThanOrEqual(GAME_SCREEN_AREA_WIDTH);
      }
      for (const rect of [geometry.overlay, geometry.nextPanel]) {
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(GAME_SCREEN_AREA_WIDTH);
      }
      expect(geometry.nextPanel.left).toBeGreaterThan(geometry.overlay.right);

      const centers = await measurePixelCenters(
        context,
        await page.screenshot(),
      );
      expect(Math.abs(centers.hud - GAME_CENTER)).toBeLessThan(5);
      expect(Math.abs(centers.board - GAME_CENTER)).toBeLessThan(5);
      expect(Math.abs(centers.hudBounds - GAME_CENTER)).toBeLessThan(5);
      expect(Math.abs(centers.boardBounds - GAME_CENTER)).toBeLessThan(5);
    } finally {
      await context.close();
    }
  },
);

itWithChromium(
  "keeps the committed VRT frame's game content centered in the game screen area",
  async () => {
    const activeBrowser = browser;
    if (!activeBrowser) return;

    const context = await activeBrowser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    try {
      const page = await context.newPage();
      await page.goto(VRT_BASELINE_DATA_URL);
      const bounds = await page.evaluate((areaWidth: number) => {
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
        const measure = (top: number, bottom: number) => {
          let count = 0;
          let weighted = 0;
          let left = areaWidth;
          let right = -1;
          for (let y = top; y < Math.min(canvas.height, bottom); y++) {
            for (let x = 0; x < areaWidth; x++) {
              const offset = (y * canvas.width + x) * 4;
              const red = pixels[offset] ?? 0;
              const green = pixels[offset + 1] ?? 0;
              const blue = pixels[offset + 2] ?? 0;
              if ((red + green + blue) / 3 < 45) continue;
              count += 1;
              weighted += x + 0.5;
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
          }
          return {
            count,
            center: count === 0 ? 0 : weighted / count,
            bounds: (left + right + 1) / 2,
            right,
          };
        };
        return {
          content: measure(80, 400),
          board: measure(240, 400),
          hud: measure(100, 180),
        };
      }, GAME_SCREEN_AREA_WIDTH);

      expect(bounds.content.count).toBeGreaterThan(4000);
      expect(bounds.content.right).toBeLessThan(GAME_SCREEN_AREA_WIDTH);
      expect(Math.abs(bounds.content.center - GAME_CENTER)).toBeLessThan(10);
      expect(Math.abs(bounds.content.bounds - GAME_CENTER)).toBeLessThan(10);
      expect(bounds.board.count).toBeGreaterThan(4000);
      expect(bounds.board.right).toBeLessThan(GAME_SCREEN_AREA_WIDTH);
      expect(Math.abs(bounds.board.center - GAME_CENTER)).toBeLessThan(16);
      expect(Math.abs(bounds.board.bounds - GAME_CENTER)).toBeLessThan(16);
      expect(bounds.hud.count).toBeGreaterThan(1000);
      expect(Math.abs(bounds.hud.bounds - GAME_CENTER)).toBeLessThan(24);
    } finally {
      await context.close();
    }
  },
);
