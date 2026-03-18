/**
 * Banner image generator
 *
 * Renders an HTML template at 600×200 px using Playwright Chromium and writes
 * the result to docs/banner.png.  The banner is intended for embedding on
 * external personal sites as a linked thumbnail.
 *
 * Usage:
 *   bun run scripts/generate-banner.ts
 */

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";

const WIDTH = 600;
const HEIGHT = 200;

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
    padding: 0 24px;
    gap: 24px;
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
    width: 148px;
    height: 148px;
    border-radius: 9999px;
    border: 4px double #6ee7b7;
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
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .name {
    font-size: 48px;
    font-weight: 700;
    color: #6ee7b7;
    line-height: 1.1;
    ruby-position: under;
    text-shadow: 0 0 20px #6ee7b740;
  }
  .name ruby rt {
    font-size: 12px;
    color: #a7f3d0;
  }
  .en-name {
    font-size: 13px;
    color: #a7f3d0;
    font-weight: 400;
    letter-spacing: 0.05em;
  }
  .tagline {
    font-size: 12px;
    line-height: 1.6;
    color: #d1fae5;
  }
  .tagline-line {
    display: inline-block;
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
    <div class="name">
      <ruby>馬<rp>(</rp><rt>ま</rt><rp>)</rp></ruby><ruby>可<rp>(</rp><rt>か</rt><rp>)</rp></ruby><ruby>無<rp>(</rp><rt>む</rt><rp>)</rp></ruby><ruby>序<rp>(</rp><rt>じょ</rt><rp>)</rp></ruby>
    </div>
    <div class="en-name">MAKA Mujo — AI VTuber</div>
    <div class="tagline"><span class="tagline-line">AIが自らゲームをプレイし、</span><span class="tagline-line">マルコフ連鎖によるトークとともにライブ配信。</span></div>
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
