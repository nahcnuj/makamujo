/**
 * OGP image generator
 *
 * Renders an HTML template at the standard OGP size (1200×630 px) using
 * Playwright Chromium and writes the result to docs/ogp.png.
 *
 * Usage:
 *   bun run scripts/generate-ogp.ts
 */

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";

const WIDTH = 1200;
const HEIGHT = 630;

const root = path.resolve(import.meta.dir, "..");
const characterImagePath = path.join(root, "src", "public", "nc433974.png");
const outputPath = path.join(root, "docs", "ogp.png");

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
    padding: 0 80px;
    gap: 60px;
    position: relative;
  }
  .bg-glow {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 60% 80% at 20% 50%, #065f4640 0%, transparent 70%);
    pointer-events: none;
  }
  .character {
    flex-shrink: 0;
    width: 300px;
    height: 300px;
    border-radius: 9999px;
    border: 6px double #6ee7b7;
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
    gap: 20px;
  }
  .name {
    font-size: 96px;
    font-weight: 700;
    color: #6ee7b7;
    line-height: 1.1;
    ruby-position: under;
  }
  .name ruby rt {
    font-size: 24px;
    color: #a7f3d0;
  }
  .en-name {
    font-size: 28px;
    color: #a7f3d0;
    font-weight: 400;
    letter-spacing: 0.06em;
  }
  .tagline {
    font-size: 22px;
    line-height: 1.7;
    color: #ecfdf5;
  }
  .tagline-line {
    display: inline-block;
  }
  .badge {
    display: inline-block;
    padding: 6px 20px;
    border: 2px solid #6ee7b7;
    border-radius: 8px;
    font-size: 18px;
    color: #6ee7b7;
    font-weight: 700;
    align-self: flex-start;
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

console.log(`OGP image generated: ${outputPath}`);
