/**
 * Banner image generator
 *
 * Generates an SVG banner at 320×100 px and writes the result to docs/banner.svg.
 * The banner is intended for embedding on external personal sites as a linked
 * thumbnail.
 *
 * Usage:
 *   bun run scripts/generate-banner.ts
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

const WIDTH = 320;
const HEIGHT = 100;

const root = path.resolve(import.meta.dir, "..");
const outputPath = path.join(root, "docs", "banner.svg");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">馬可無序 バナー画像</title>
  <desc id="desc">AI VTuberプロジェクト 馬可無序の配信中バナー</desc>
  <defs>
    <radialGradient id="glowLeft" cx="18%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#065f46" stop-opacity="0.38" />
      <stop offset="65%" stop-color="#065f46" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="glowRight" cx="80%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#0d2d1c" stop-opacity="0.25" />
      <stop offset="70%" stop-color="#0d2d1c" stop-opacity="0" />
    </radialGradient>
    <clipPath id="characterClip">
      <circle cx="38" cy="38" r="38" />
    </clipPath>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="#000" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowLeft)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowRight)" />

  <g transform="translate(12 12)">
    <circle cx="38" cy="38" r="38" fill="#0d1a12" />
    <g clip-path="url(#characterClip)">
      <image href="nc433974.png" x="-76" y="0" width="76" height="76" transform="scale(-1 1)" preserveAspectRatio="xMidYMin slice" />
    </g>
    <circle cx="38" cy="38" r="37" fill="none" stroke="#6ee7b7" stroke-width="1" />
    <circle cx="38" cy="38" r="34" fill="none" stroke="#6ee7b7" stroke-opacity="0.65" stroke-width="1" />
  </g>

  <text x="100" y="29" fill="#a7f3d0" font-size="11" font-weight="700" font-family="'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic', sans-serif" letter-spacing="0.12em">AI VTuberプロジェクト</text>

  <text x="100" y="58" fill="#6ee7b7" font-size="28" font-weight="700" font-family="'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic', sans-serif">馬可無序</text>

  <text x="208" y="53" fill="#a7f3d0" font-size="11" font-family="'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic', sans-serif" letter-spacing="0.12em">まかむじょ</text>
  <text x="208" y="67" fill="#a7f3d0" font-size="9" font-family="'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic', sans-serif" letter-spacing="0.04em">MAKA Mujo</text>

  <rect x="100" y="73" width="198" height="20" rx="4" ry="4" fill="#0d2d1c" fill-opacity="0.5" stroke="#6ee7b7" stroke-width="1" />
  <text x="199" y="86.5" text-anchor="middle" dominant-baseline="middle" fill="#6ee7b7" font-size="9" font-weight="700" font-family="'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic', sans-serif">🎮 ニコニコ生放送で配信中</text>
</svg>
`;

writeFileSync(outputPath, `${svg.trim()}\n`);

console.log(`Banner image generated: ${outputPath}`);
