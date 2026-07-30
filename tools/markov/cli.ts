#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { MarkovChainModel } from "../../lib/MarkovChainModel";

const csvEscape = (value: string | number): string => {
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
};

const printCsv = (header: string[], rows: (string | number)[][]) => {
  console.log(header.map(csvEscape).join(","));
  for (const row of rows) {
    console.log(row.map(csvEscape).join(","));
  }
};

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    delta: { type: "string", default: "1" },
    top: { type: "string", default: "50" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

const [cmd, ...rest] = positionals;

function load(path: string): MarkovChainModel {
  try {
    return MarkovChainModel.fromFile(path);
  } catch (e) {
    console.error(`failed to load model: ${path}`, e);
    process.exit(1);
  }
}

function usage(): never {
  console.error(`Usage:
  bun run tools/markov/cli.ts decrement-phrase <modelPath> <phrase> [--delta N]
  bun run tools/markov/cli.ts tokens <modelPath> [--top N]
  bun run tools/markov/cli.ts search <modelPath> <query>
  bun run tools/markov/cli.ts transitions <modelPath> <word>`);
  process.exit(values.help ? 0 : 1);
}

if (!cmd || values.help) usage();

switch (cmd) {
  case "decrement-phrase": {
    const [modelPath, phrase] = rest;
    if (!modelPath || phrase == null) {
      console.error("modelPath and phrase are required");
      usage();
    }
    const tokens = phrase.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      console.error("phrase is empty");
      process.exit(1);
    }
    const delta = Math.max(1, parseInt(values.delta ?? "1", 10) || 1);
    const model = load(modelPath);
    const updated = model.decrementPhrase(tokens, delta);
    process.stdout.write(updated.toJSON());
    if (process.stdout.isTTY) process.stdout.write("\n");
    break;
  }
  case "tokens": {
    const [modelPath] = rest;
    if (!modelPath) usage();
    const top = Math.max(1, parseInt(values.top ?? "50", 10) || 50);
    const stats = load(modelPath).tokenStats().slice(0, top);
    printCsv(
      ["token", "asFrom", "asToWeight"],
      stats.map((s) => [s.token, s.asFrom, s.asToWeight]),
    );
    break;
  }
  case "search": {
    const [modelPath, query] = rest;
    if (!modelPath || query == null) usage();
    const hits = load(modelPath).tokenStats().filter((t) => t.token.includes(query));
    printCsv(
      ["token", "asFrom", "asToWeight"],
      hits.map((s) => [s.token, s.asFrom, s.asToWeight]),
    );
    break;
  }
  case "transitions": {
    const [modelPath, word] = rest;
    if (!modelPath || word == null) usage();
    const t = load(modelPath).transitionsOf(word);
    printCsv(
      ["direction", "other", "weight"],
      [
        ...Object.entries(t.asFrom).map(([other, weight]) => ["from", other, weight] as (string | number)[]),
        ...t.asTo.map(({ from, weight }) => ["to", from, weight] as (string | number)[]),
      ],
    );
    break;
  }
  default:
    console.error(`unknown command: ${cmd}`);
    usage();
}
