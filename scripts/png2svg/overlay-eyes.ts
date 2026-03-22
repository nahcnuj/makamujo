import fs from "fs";
import path from "path";

const inputSvg = path.resolve("src/public/nc433974.svg");
const outputSvg = path.resolve("src/public/nc433974_eyes_closed.svg");

const svg = fs.readFileSync(inputSvg, "utf8");
if (!svg.includes("</svg>")) {
  throw new Error("Invalid SVG file format");
}

const overlay = `  <g id="eyes-closed" opacity="0.95" fill="none" stroke="#000" stroke-width="8" stroke-linecap="round">
    <path d="M236 330 C260 322, 280 322, 304 330" />
    <path d="M416 330 C440 322, 460 322, 484 330" />
  </g>\n`;

const result = svg.replace("</svg>", `${overlay}</svg>`);
fs.writeFileSync(outputSvg, result, "utf8");
console.log(`Created ${outputSvg}`);
