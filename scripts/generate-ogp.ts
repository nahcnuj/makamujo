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

const html = `\
<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    overflow: hidden;
    background: #000;
    font-family: 'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic', sans-serif;
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
    background: radial-gradient(ellipse 70% 90% at 18% 50%, #065f4660 0%, transparent 65%),
                radial-gradient(ellipse 50% 60% at 75% 50%, #0d2d1c40 0%, transparent 70%);
    pointer-events: none;
  }
  .character {
    flex-shrink: 0;
    width: 340px;
    height: 340px;
    border-radius: 9999px;
    border: 7px double #6ee7b7;
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
    font-size: 104px;
    font-weight: 700;
    color: #6ee7b7;
    line-height: 1.1;
    ruby-position: under;
    text-shadow: 0 0 30px #6ee7b740;
  }
  .name ruby rt {
    font-size: 26px;
    color: #a7f3d0;
  }
  .en-name {
    font-size: 28px;
    color: #a7f3d0;
    font-weight: 400;
    letter-spacing: 0.06em;
  }
  .tagline {
    font-size: 24px;
    line-height: 1.7;
    color: #d1fae5;
  }
  .tagline-line {
    display: inline-block;
  }
  .badge {
    display: inline-block;
    padding: 14px 32px;
    border: 3px solid #6ee7b7;
    border-radius: 10px;
    font-size: 28px;
    color: #6ee7b7;
    font-weight: 700;
    align-self: flex-start;
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
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: outputPath, type: "png" });
await browser.close();

console.log(`OGP image generated: ${outputPath}`);
