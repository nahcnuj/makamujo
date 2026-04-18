import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const ROOT_DIR = path.resolve(import.meta.dir, "..");
const DEFAULT_INPUT_PATH = path.join(ROOT_DIR, "var", "screenshots", "console-agent-status-mock.png");
const DEFAULT_OUTPUT_PATH = path.join(ROOT_DIR, "var", "screenshots", "console-agent-status-mock-annotated.png");
const TESSERACT_TSV_TEXT_COLUMN_INDEX = 11;
const TESSERACT_TSV_MIN_COLUMN_COUNT = 12;
const RECTANGLE_MARGIN_PX = 8;

const TARGET_LABELS = [
  "配信エージェントの状態",
  "実配信状態が取得できないため、モック表示中",
  "配信エージェント状態モック",
  "Agent情報",
] as const;

type OcrWord = {
  level: number;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  text: string;
  blockNum: number;
  paragraphNum: number;
  lineNum: number;
};

const parsePathArgument = (flag: "--input" | "--output", defaultValue: string) => {
  const index = process.argv.findIndex((argument) => argument === flag);
  if (index === -1) {
    return defaultValue;
  }
  const value = process.argv[index + 1];
  if (!value) {
    throw new Error(`${flag} の値が必要です。`);
  }
  return path.resolve(process.cwd(), value);
};

const inputPath = parsePathArgument("--input", DEFAULT_INPUT_PATH);
const outputPath = parsePathArgument("--output", DEFAULT_OUTPUT_PATH);

const ensureCommandExists = (command: string, installHint: string) => {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], { stdio: "ignore" });
  if (result.status !== 0) {
    throw new Error(`${command} が見つかりません。${installHint}`);
  }
};

const normalizeText = (value: string) => value.replace(/\s+/g, "");

ensureCommandExists("tesseract", "`sudo apt-get install -y tesseract-ocr tesseract-ocr-jpn` を実行してください。");
ensureCommandExists("convert", "`sudo apt-get install -y imagemagick` を実行してください。");

const tesseractResult = spawnSync(
  "tesseract",
  [inputPath, "stdout", "-l", "jpn+eng", "tsv"],
  { encoding: "utf-8" },
);
if (tesseractResult.status !== 0) {
  throw new Error(`OCR実行に失敗しました: ${tesseractResult.stderr}`);
}

const tsvLines = tesseractResult.stdout
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0);
const words = tsvLines.slice(1).map((line): OcrWord | null => {
  const columns = line.split("\t");
  // Tesseract TSV format: level/page/block/par/line/word/left/top/width/height/conf/text.
  if (columns.length < TESSERACT_TSV_MIN_COLUMN_COUNT) {
    return null;
  }
  const text = columns[TESSERACT_TSV_TEXT_COLUMN_INDEX] ?? "";
  if (!text.trim()) {
    return null;
  }
  return {
    level: Number(columns[0]),
    left: Number(columns[6]),
    top: Number(columns[7]),
    width: Number(columns[8]),
    height: Number(columns[9]),
    conf: Number(columns[10]),
    text,
    blockNum: Number(columns[2]),
    paragraphNum: Number(columns[3]),
    lineNum: Number(columns[4]),
  };
}).filter((word): word is OcrWord => word !== null);

const lineGroups = new Map<
  string,
  {
    text: string[];
    left: number;
    top: number;
    right: number;
    bottom: number;
  }
>();

for (const word of words) {
  const key = `${word.blockNum}:${word.paragraphNum}:${word.lineNum}`;
  const currentGroup = lineGroups.get(key);
  const right = word.left + word.width;
  const bottom = word.top + word.height;
  if (!currentGroup) {
    lineGroups.set(key, {
      text: [word.text],
      left: word.left,
      top: word.top,
      right,
      bottom,
    });
    continue;
  }
  currentGroup.text.push(word.text);
  currentGroup.left = Math.min(currentGroup.left, word.left);
  currentGroup.top = Math.min(currentGroup.top, word.top);
  currentGroup.right = Math.max(currentGroup.right, right);
  currentGroup.bottom = Math.max(currentGroup.bottom, bottom);
}

const lineCandidates = [...lineGroups.values()].map((lineGroup) => ({
  text: lineGroup.text.join(" "),
  normalizedText: normalizeText(lineGroup.text.join(" ")),
  left: lineGroup.left,
  top: lineGroup.top,
  right: lineGroup.right,
  bottom: lineGroup.bottom,
}));

const matchedRectangles: Array<{ left: number; top: number; right: number; bottom: number; label: string }> = [];

for (const label of TARGET_LABELS) {
  const normalizedLabel = normalizeText(label);
  const matchedLine = lineCandidates.find((lineCandidate) => lineCandidate.normalizedText.includes(normalizedLabel));
  if (!matchedLine) {
    continue;
  }
  matchedRectangles.push({
    left: matchedLine.left,
    top: matchedLine.top,
    right: matchedLine.right,
    bottom: matchedLine.bottom,
    label,
  });
}

if (matchedRectangles.length === 0) {
  throw new Error("OCR結果から赤枠対象テキストを検出できませんでした。");
}

const drawArguments = matchedRectangles.flatMap((rectangle) => {
  const left = Math.max(rectangle.left - RECTANGLE_MARGIN_PX, 0);
  const top = Math.max(rectangle.top - RECTANGLE_MARGIN_PX, 0);
  const right = rectangle.right + RECTANGLE_MARGIN_PX;
  const bottom = rectangle.bottom + RECTANGLE_MARGIN_PX;
  return ["-draw", `rectangle ${left},${top} ${right},${bottom}`];
});

mkdirSync(path.dirname(outputPath), { recursive: true });
const convertResult = spawnSync(
  "convert",
  [inputPath, "-stroke", "#ff3b30", "-strokewidth", "4", "-fill", "none", ...drawArguments, outputPath],
  { encoding: "utf-8" },
);
if (convertResult.status !== 0) {
  throw new Error(`赤枠描画に失敗しました: ${convertResult.stderr}`);
}

console.log("Detected labels:");
for (const rectangle of matchedRectangles) {
  console.log(`- ${rectangle.label}`);
}
console.log(`Annotated screenshot saved: ${outputPath}`);
