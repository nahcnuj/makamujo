import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium } from "playwright";
import {
  countChangedPixels,
  type HeartbeatFrame,
  parseHeartbeatBandSpec,
  sampleHeartbeatFrame,
} from "./broadcastHeartbeatLiveness";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(
  join(here, "..", "..", "..", "src", "index.css"),
  "utf8",
);

/**
 * Chromium が無い環境（依存関係を絞った CI でも）でも unit test を
 * 落とさないようにする。帯の判定そのものは
 * `broadcastHeartbeatLiveness.test.ts` が検証する。
 */
const launchBrowser = async (): Promise<Browser | undefined> => {
  try {
    return await chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
  } catch {
    return undefined;
  }
};

const browser = await launchBrowser();

/** 帯の CSS だけを切り出して、検知側と同じ 128x72 へ縮めた絵にする。 */
const renderFrames = async (times: number[]): Promise<HeartbeatFrame[]> => {
  if (!browser) throw new Error("browser is not available");
  const bandCss = css.slice(
    css.indexOf("@keyframes broadcast-heartbeat-sweep"),
    css.indexOf("}", css.indexOf("will-change: transform;")),
  );
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:#000;}${bandCss}</style></head><body><div class="broadcast-heartbeat"></div></body></html>`,
  );
  const frames: HeartbeatFrame[] = [];
  for (const time of times) {
    await page.evaluate((elapsed) => {
      for (const animation of document.getAnimations()) {
        animation.pause();
        animation.currentTime = elapsed;
      }
    }, time);
    const shot = await page.screenshot();
    const rows = await page.evaluate(
      async (uri) => {
        const image = new Image();
        image.src = uri;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 72;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(image, 0, 0, 128, 72);
        const { data } = ctx.getImageData(0, 0, 128, 72);
        const out: number[][] = [];
        for (let row = 0; row < 72; row += 1) {
          for (let col = 0; col < 128; col += 1) {
            const index = (row * 128 + col) * 4;
            out.push([
              (data[index] ?? 0) / 255,
              (data[index + 1] ?? 0) / 255,
              (data[index + 2] ?? 0) / 255,
            ]);
          }
        }
        return out;
      },
      `data:image/png;base64,${shot.toString("base64")}`,
    );
    if (!rows) throw new Error("canvas is not available");
    const data = new Float32Array(rows.length * 3);
    rows.forEach((pixel, index) => {
      data[index * 3] = pixel[0] ?? 0;
      data[index * 3 + 1] = pixel[1] ?? 0;
      data[index * 3 + 2] = pixel[2] ?? 0;
    });
    frames.push({ width: 128, height: 72, data });
  }
  await page.close();
  return frames;
};

describe("broadcast heartbeat liveness (browser)", () => {
  it.skipIf(!browser)("decides the same as the browser rendering", async () => {
    const spec = parseHeartbeatBandSpec(css);
    const times = Array.from({ length: 12 }, (_, index) =>
      Math.round((index * 1000) / 30),
    );
    const rendered = await renderFrames(times);
    const modeled = times.map((elapsed) =>
      sampleHeartbeatFrame(spec, { elapsedMs: elapsed }),
    );

    for (let index = 1; index < times.length; index += 1) {
      const previousRendered = rendered[index - 1];
      const currentRendered = rendered[index];
      const previousModeled = modeled[index - 1];
      const currentModeled = modeled[index];
      if (
        !previousRendered ||
        !currentRendered ||
        !previousModeled ||
        !currentModeled
      ) {
        throw new Error("frame is missing");
      }
      const renderedChanged =
        countChangedPixels(previousRendered, currentRendered) / (128 * 72);
      const modeledChanged =
        countChangedPixels(previousModeled, currentModeled) / (128 * 72);

      // 「動いた」と判定するかどうかが一致すること。
      expect(modeledChanged > 0.001).toBe(renderedChanged > 0.001);
      // Pictures differ only by the edges of the band, so the difference
      // of the ratios stays within about one row.
      expect(Math.abs(modeledChanged - renderedChanged)).toBeLessThan(0.02);
    }
  });
});
