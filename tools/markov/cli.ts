#!/usr/bin/env bun
import { copyFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

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

function splitPhrase(phrase: string, delimiter: string): string[] {
  const d = delimiter || " ";
  return phrase
    .split(d)
    .map((s) => s.trim())
    .filter(Boolean);
}

const { values, positionals } = parseArgs({
  args: expandInPlaceArgs(Bun.argv.slice(2)),
  options: {
    delta: { type: "string", default: "1" },
    "in-place": { type: "boolean", short: "i", default: false },
    suffix: { type: "string", default: "" },
    delimiter: { type: "string", short: "d", default: " " },
    purge: { type: "boolean", default: false },
    sort: { type: "string", default: "asToWeight" },
    tail: { type: "string" },
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
  bun run tools/markov/cli.ts corpus <modelPath> [--tail N]
  bun run tools/markov/cli.ts unlearn <modelPath> <n> [-i|-iSUFFIX]
  bun run tools/markov/cli.ts decrement-phrase <modelPath> <phrase> [--delta N | --purge] [-i|-iSUFFIX] [-d DELIM]
  bun run tools/markov/cli.ts tokens <modelPath> [--sort token|asFrom|asToWeight]
  bun run tools/markov/cli.ts search <modelPath> <query>
  bun run tools/markov/cli.ts transitions <modelPath> <word> [-d DELIM]

  corpus: list entries (1=newest). unlearn: n is 1-based from the end.
  unlearn: one learn worth of -1 on transitions, then drop that corpus entry.`);
  process.exit(values.help ? 0 : 1);
}

if (!cmd || values.help) usage();

switch (cmd) {
  case "corpus": {
    const [modelPath] = rest;
    if (!modelPath) {
      console.error("modelPath is required");
      usage();
    }
    const model = load(modelPath);
    // biome-ignore lint/plugin/no-type-assertion: existing assertion
    const { corpus = [] } = JSON.parse(model.toJSON()) as { corpus?: string[] };
    let start = 0;
    if (values.tail != null) {
      const tail = parseInt(values.tail, 10);
      if (!Number.isFinite(tail) || tail < 1) {
        console.error(`--tail must be a positive integer, got ${values.tail}`);
        process.exit(1);
      }
      start = Math.max(0, corpus.length - tail);
    }
    // print oldest-first among the slice; n is 1-based from end
    for (let i = start; i < corpus.length; i++) {
      const nFromEnd = corpus.length - i;
      console.log(`${nFromEnd}\t${corpus[i]}`);
    }
    break;
  }
  case "unlearn": {
    const [modelPath, nStr] = rest;
    if (!modelPath || nStr == null) {
      console.error("modelPath and n are required");
      usage();
    }
    const n = parseInt(nStr, 10);
    if (!Number.isFinite(n) || n < 1) {
      console.error(`n must be a positive integer, got ${nStr}`);
      process.exit(1);
    }
    const model = load(modelPath);
    const beforeText = model.corpusFromEnd(n);
    if (beforeText == null) {
      console.error(
        `n=${n} out of range (corpus length ${model.corpusLength()})`,
      );
      process.exit(1);
    }
    let updated: ReturnType<MarkovChainModel["unlearnFromEnd"]>;
    try {
      updated = model.unlearnFromEnd(n);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
    console.error(`unlearn n=${n} from-end text=${JSON.stringify(beforeText)}`);
    console.error(
      `corpus: ${model.corpusLength()} => ${updated.corpusLength()}`,
    );

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
  case "decrement-phrase": {
    const [modelPath, phrase] = rest;
    if (!modelPath || phrase == null) {
      console.error("modelPath and phrase are required");
      usage();
    }
    const tokens = splitPhrase(phrase, values.delimiter ?? " ");
    if (tokens.length === 0) {
      console.error("phrase is empty");
      process.exit(1);
    }

    const deltaExplicit = Bun.argv
      .slice(2)
      .some((a) => a === "--delta" || a.startsWith("--delta="));
    if (values.purge && deltaExplicit) {
      console.error("--purge and --delta cannot be used together");
      process.exit(1);
    }
    const delta = Math.max(1, parseInt(values.delta ?? "1", 10) || 1);
    const model = load(modelPath);
    // biome-ignore lint/plugin/no-type-assertion: existing assertion
    const before = JSON.parse(model.toJSON()).model as Record<
      string,
      Record<string, number>
    >;
    const updated = model.decrementPhrase(
      tokens,
      values.purge ? { purge: true } : { delta },
    );
    // biome-ignore lint/plugin/no-type-assertion: existing assertion
    const after = JSON.parse(updated.toJSON()).model as Record<
      string,
      Record<string, number>
    >;

    const ctxLabel = (s: string) => vis(s) || "(BOS)";
    let changed = 0;
    console.error(
      `decrement-phrase ${values.purge ? "purge" : `delta=${delta}`} tokens=${JSON.stringify(tokens)}`,
    );
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const ka = before[k] ?? {};
      const kb = after[k] ?? {};
      for (const t of new Set([...Object.keys(ka), ...Object.keys(kb)])) {
        const wa = ka[t] ?? 0;
        const wb = kb[t] ?? 0;
        if (wa !== wb) {
          console.error(`${ctxLabel(k)} -> ${vis(t)}: ${wa} => ${wb}`);
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
    const sort = values.sort ?? "asToWeight";
    let stats = load(modelPath).tokenStats();
    if (sort === "token") {
      stats = [...stats].sort((a, b) => a.token.localeCompare(b.token, "ja"));
    } else if (sort === "asFrom") {
      stats = [...stats].sort((a, b) => b.asFrom - a.asFrom);
    } else if (sort === "asToWeight") {
      stats = [...stats].sort((a, b) => b.asToWeight - a.asToWeight);
    } else {
      console.error(`unknown --sort: ${sort} (token|asFrom|asToWeight)`);
      process.exit(1);
    }
    printCsv(
      ["token", "asFrom", "asToWeight"],
      stats.map((s) => [vis(s.token), s.asFrom, s.asToWeight]),
    );
    break;
  }
  case "search": {
    const [modelPath, query] = rest;
    if (!modelPath || query == null) usage();
    const hits = load(modelPath)
      .tokenStats()
      .filter((t) => t.token.includes(query));
    printCsv(
      ["token", "asFrom", "asToWeight"],
      hits.map((s) => [vis(s.token), s.asFrom, s.asToWeight]),
    );
    break;
  }
  case "transitions": {
    const [modelPath, word] = rest;
    if (!modelPath || word == null) usage();
    const t = load(modelPath).transitionsOf(
      splitPhrase(word, values.delimiter ?? " ").join(" "),
    );
    const normalized = splitPhrase(word, values.delimiter ?? " ").join(
      "\u0000",
    );
    printCsv(
      ["direction", "context", "other", "weight"],
      [
        ...t.fromContexts.map(
          ({ context, next, weight }) =>
            // biome-ignore lint/plugin/no-type-assertion: existing assertion
            ["from", vis(context), next, weight] as (string | number)[],
        ),
        ...t.asTo.map(
          ({ from, weight }) =>
            // biome-ignore lint/plugin/no-type-assertion: existing assertion
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
