#!/usr/bin/env bun
import { copyFileSync, writeFileSync } from "node:fs";

import { MarkovChainModel } from "../../lib/MarkovChainModel";
import {
  commandUsageLine,
  expandInPlaceArgs,
  isMarkovCommand,
  MARKOV_COMMANDS,
  type MarkovCommandArgs,
  parseMarkovCommandArgs,
} from "./commandArgs";

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

function load(path: string): MarkovChainModel {
  try {
    return MarkovChainModel.fromFile(path);
  } catch (e) {
    console.error(`failed to load model: ${path}`, e);
    process.exit(1);
  }
}

function usage(exitCode: 0 | 1): never {
  console.error(`Usage:
${MARKOV_COMMANDS.map((command) => commandUsageLine(command)).join("\n")}

  corpus: list entries (1=newest). unlearn: n is 1-based from the end.
  unlearn: one learn worth of -1 on transitions, then drop that corpus entry.`);
  process.exit(exitCode);
}

// The command name is the first argument that is not an option; everything
// after it is parsed by that command's own option set.
const expandedArgv = expandInPlaceArgs(Bun.argv.slice(2));
const commandIndex = expandedArgv.findIndex((arg) => !arg.startsWith("-"));
const commandName =
  commandIndex === -1 ? undefined : expandedArgv[commandIndex];
const helpRequested =
  expandedArgv.includes("-h") || expandedArgv.includes("--help");
const commandArgs =
  commandIndex === -1
    ? []
    : expandedArgv.filter((_, index) => index !== commandIndex);

if (commandName === undefined) {
  usage(helpRequested ? 0 : 1);
}

if (!isMarkovCommand(commandName)) {
  console.error(`unknown command: ${commandName}`);
  usage(1);
}

let args: MarkovCommandArgs;
try {
  args = parseMarkovCommandArgs(commandName, commandArgs);
} catch (err) {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  console.error(`\nValid usage for \`${commandName}\`:`);
  console.error(commandUsageLine(commandName));
  process.exit(1);
}

if (args.help) {
  usage(0);
}

switch (args.command) {
  case "corpus": {
    const [modelPath] = args.positionals;
    if (!modelPath) {
      console.error("modelPath is required");
      usage(1);
    }
    const model = load(modelPath);
    // biome-ignore lint/plugin/no-type-assertion: existing assertion
    const { corpus = [] } = JSON.parse(model.toJSON()) as { corpus?: string[] };
    let start = 0;
    if (args.tail != null) {
      const tail = parseInt(args.tail, 10);
      if (!Number.isFinite(tail) || tail < 1) {
        console.error(`--tail must be a positive integer, got ${args.tail}`);
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
    const [modelPath, nStr] = args.positionals;
    if (!modelPath || nStr == null) {
      console.error("modelPath and n are required");
      usage(1);
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

    if (args.inPlace) {
      const suffix = args.suffix;
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
    const [modelPath, phrase] = args.positionals;
    if (!modelPath || phrase == null) {
      console.error("modelPath and phrase are required");
      usage(1);
    }
    const tokens = splitPhrase(phrase, args.delimiter);
    if (tokens.length === 0) {
      console.error("phrase is empty");
      process.exit(1);
    }

    if (args.purge && args.delta !== undefined) {
      console.error("--purge and --delta cannot be used together");
      process.exit(1);
    }
    const delta = Math.max(1, parseInt(args.delta ?? "1", 10) || 1);
    const model = load(modelPath);
    // biome-ignore lint/plugin/no-type-assertion: existing assertion
    const before = JSON.parse(model.toJSON()).model as Record<
      string,
      Record<string, number>
    >;
    const updated = model.decrementPhrase(
      tokens,
      args.purge ? { purge: true } : { delta },
    );
    // biome-ignore lint/plugin/no-type-assertion: existing assertion
    const after = JSON.parse(updated.toJSON()).model as Record<
      string,
      Record<string, number>
    >;

    const ctxLabel = (s: string) => vis(s) || "(BOS)";
    let changed = 0;
    console.error(
      `decrement-phrase ${args.purge ? "purge" : `delta=${delta}`} tokens=${JSON.stringify(tokens)}`,
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

    if (args.inPlace) {
      const suffix = args.suffix;
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
    const [modelPath] = args.positionals;
    if (!modelPath) usage(1);
    const sort = args.sort;
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
    const [modelPath, query] = args.positionals;
    if (!modelPath || query == null) usage(1);
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
    const [modelPath, word] = args.positionals;
    if (!modelPath || word == null) usage(1);
    const t = load(modelPath).transitionsOf(
      splitPhrase(word, args.delimiter).join(" "),
    );
    const normalized = splitPhrase(word, args.delimiter).join("\u0000");
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
}
