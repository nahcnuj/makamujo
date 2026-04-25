#!/usr/bin/env node
import fs from "fs";
import path from "path";

const LCOV_PATH = path.resolve(process.cwd(), "coverage", "lcov.info");
if (!fs.existsSync(LCOV_PATH)) {
  console.error("No coverage/lcov.info found. Run tests with --coverage to generate it.");
  process.exit(0);
}

const content = fs.readFileSync(LCOV_PATH, "utf8");
const lines = content.split(/\r?\n/);

const records = [];
let cur = null;
for (const line of lines) {
  if (line.startsWith("SF:")) {
    if (cur) records.push(cur);
    cur = { file: line.slice(3), LF: 0, LH: 0 };
    continue;
  }
  if (!cur) continue;
  if (line.startsWith("LF:")) cur.LF = parseInt(line.slice(3)) || 0;
  if (line.startsWith("LH:")) cur.LH = parseInt(line.slice(3)) || 0;
  if (line === "end_of_record") {
    records.push(cur);
    cur = null;
  }
}
if (cur) records.push(cur);

const isTestFile = (filePath) => {
  const p = filePath.replace(/\\/g, "/");
  if (/\/tests?\//i.test(p)) return true;
  if (/\.test\.(ts|tsx|js|jsx)$/i.test(p)) return true;
  return false;
};

const included = records.filter((r) => !isTestFile(r.file));
const excluded = records.filter((r) => isTestFile(r.file));

const pct = (hit, found) => (found === 0 ? 100 : Math.round((hit / found) * 10000) / 100);

let totalLF = 0;
let totalLH = 0;
for (const r of included) {
  totalLF += r.LF;
  totalLH += r.LH;
}

console.log("");
console.log("Filtered coverage report (test files excluded):");
console.log("");
console.log(String("File").padEnd(70) + " | %   (hit/lines)");
console.log("-".repeat(96));
for (const r of included) {
  const per = pct(r.LH, r.LF).toFixed(2).padStart(6);
  const rel = path.relative(process.cwd(), r.file);
  console.log(String(rel).padEnd(70) + " | " + per + `%  (${r.LH}/${r.LF})`);
}
console.log("-".repeat(96));
console.log(String("Total").padEnd(70) + " | " + pct(totalLH, totalLF).toFixed(2).padStart(6) + `%  (${totalLH}/${totalLF})`);
console.log("");
console.log(`Excluded ${excluded.length} file(s) (test files).`);

process.exit(0);
