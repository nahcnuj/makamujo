/**
 * Banner image generator
 *
 * Renders an HTML template at 320×100 px using Playwright Chromium and writes
 * the result to docs/banner.png.  The banner is intended for embedding on
 * external personal sites as a linked thumbnail.
 *
 * Usage:
 *   bun run scripts/generate-banner.ts
 */

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";

const WIDTH = 320;
const HEIGHT = 100;

const root = path.resolve(import.meta.dir, "..");
const characterImagePath = path.join(root, "src", "public", "nc433974.png");
const outputPath = path.join(root, "docs", "banner.png");

const characterImageBase64 = readFileSync(characterImagePath).toString("base64");
const characterImageDataUrl = `data:image/png;base64,${characterImageBase64}`;

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    overflow: hidden;
    background: #000;
    font-family: 'Noto Sans CJK JP', 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif;
    color: #ecfdf5;
  }
  .container {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    padding: 0 12px;
    gap: 12px;
    position: relative;
  }
  .bg-glow {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 60% 100% at 18% 50%, #065f4660 0%, transparent 65%),
                radial-gradient(ellipse 50% 60% at 80% 50%, #0d2d1c40 0%, transparent 70%);
    pointer-events: none;
  }
  .character {
    flex-shrink: 0;
    width: 76px;
    height: 76px;
    border-radius: 9999px;
    border: 2px double #6ee7b7;
    background: #0d1a12;
    overflow: hidden;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }
  .character img {
    width: 100%;
    transform: scaleX(-1);
    object-fit: cover;
    object-position: top;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .name-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .kanji {
    font-size: 28px;
    font-weight: 700;
    color: #6ee7b7;
    line-height: 1;
    white-space: nowrap;
    text-shadow: 0 0 12px #6ee7b740;
  }
  .name-sub {
    display: flex;
    flex-direction: column;
    gap: 2px;
    justify-content: center;
  }
  .ruby {
    font-size: 11px;
    color: #a7f3d0;
    letter-spacing: 0.12em;
  }
  .en-name {
    font-size: 9px;
    color: #a7f3d0;
    font-weight: 400;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .badge {
    display: block;
    padding: 3px 8px;
    border: 1px solid #6ee7b7;
    border-radius: 4px;
    font-size: 9px;
    color: #6ee7b7;
    font-weight: 700;
    text-align: center;
    background: #0d2d1c80;
  }
</style>
</head>
<body>
<div class="container">
  <div class="bg-glow"></div>
  <div class="character">
    <img src="${characterImageDataUrl}" alt="" />
  </div>
  <div class="text">
    <div class="name-row">
      <div class="kanji">馬可無序</div>
      <div class="name-sub">
        <div class="ruby">まかむじょ</div>
        <div class="en-name">MAKA Mujo</div>
      </div>
    </div>
    <div class="badge">🎮 ニコニコ生放送で配信中</div>
  </div>
</div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: WIDTH, height: HEIGHT });
await page.setContent(html, { waitUntil: "networkidle" });
await page.screenshot({ path: outputPath, type: "png" });
await browser.close();

console.log(`Banner image generated: ${outputPath}`);
