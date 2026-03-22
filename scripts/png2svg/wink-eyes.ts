import fs from "fs";
import path from "path";

const inputSvg = path.resolve("src/public/nc433974.svg");
const outputSvg = path.resolve("src/public/nc433974_wink.svg");

const svg = fs.readFileSync(inputSvg, "utf8");
if (!svg.includes("</svg>")) {
  throw new Error("Invalid SVG file format");
}

const overlay = `  <g id="wink" opacity="0.95" fill="none" stroke="#000" stroke-width="8" stroke-linecap="round">
    <!-- 左目：閉じた状態 -->
    <path d="M236 330 C260 322, 280 322, 304 330" />
    <!-- 右目：ウインク用半開 (下弧) -->
    <path d="M416 335 C440 343, 460 343, 484 335" />
  </g>\n`;

const result = svg.replace("</svg>", `${overlay}</svg>`);
fs.writeFileSync(outputSvg, result, "utf8");
console.log(`Created ${outputSvg}`);
