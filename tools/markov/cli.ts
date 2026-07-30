#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { writeFileSync, copyFileSync } from "node:fs";

function expandInPlaceArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (const a of argv) {
    if (a.startsWith("-i") && a.length > 2 && !a.startsWith("--")) {
      out.push("-i", "--suffix", a.slice(2));
    } else {
      out.push(a);
    }
  }
  return out;
}

import { MarkovChainModel } from "../../lib/MarkovChainModel";

const vis = (s: string) => s.replaceAll("\u0000", "/");

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
  args: expandInPlaceArgs(Bun.argv.slice(2)),
  options: {
    delta: { type: "string", default: "1" },
    top: { type: "string", default: "50" },
    "in-place": { type: "boolean", short: "i", default: false },
    suffix: { type: "string", default: "" },
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
  bun run tools/markov/cli.ts decrement-phrase <modelPath> <phrase> [--delta N] [-i|-iSUFFIX] [--suffix SUFFIX]
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
    const before = JSON.parse(model.toJSON()).model as Record<string, Record<string, number>>;
    const updated = model.decrementPhrase(tokens, delta);
    const after = JSON.parse(updated.toJSON()).model as Record<string, Record<string, number>>;

    const ctxLabel = (s: string) => s.replaceAll("\u0000", "/") || "(BOS)";
    let changed = 0;
    console.error(`decrement-phrase delta=${delta} tokens=${JSON.stringify(tokens)}`);
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const ka = before[k] ?? {};
      const kb = after[k] ?? {};
      for (const t of new Set([...Object.keys(ka), ...Object.keys(kb)])) {
        const wa = ka[t] ?? 0;
        const wb = kb[t] ?? 0;
        if (wa !== wb) {
          console.error(`${ctxLabel(k)} -> ${t}: ${wa} => ${wb}`);
          changed++;
        }
      }
    }
    console.error(`changed: ${changed} transitions`);

    if (values["in-place"]) {
      const suffix = values.suffix ?? "";
      if (suffix) {
        const backupPath = modelPath + suffix;
        copyFileSync(modelPath, backupPath);
        console.error(`backup: ${backupPath}`);
      }
      writeFileSync(modelPath, updated.toJSON(), "utf8");
      console.error(`wrote: ${modelPath}`);
    } else {
      process.stdout.write(updated.toJSON());
      if (process.stdout.isTTY) process.stdout.write("\n");
    }
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
    const normalized = word.trim().split(/\s+/).filter(Boolean).join("\u0000");
    printCsv(
      ["direction", "context", "other", "weight"],
      [
        ...t.fromContexts.map(
          ({ context, next, weight }) =>
            ["from", vis(context), next, weight] as (string | number)[],
        ),
        ...t.asTo.map(
          ({ from, weight }) =>
            ["to", vis(from), vis(normalized), weight] as (string | number)[],
        ),
      ],
    );
    break;
  }
  default:
    console.error(`unknown command: ${cmd}`);
    usage();
}
