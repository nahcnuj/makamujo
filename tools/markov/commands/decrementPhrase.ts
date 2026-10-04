/**
 * `bun run markov decrement-phrase <modelPath> <phrase> [--delta] [--purge] [-i] [--suffix] [-d]`
 * フレーズの遷移を弱める（--purge なら消す）。
 */
import { MarkovChainModel } from "../../../lib/MarkovChainModel";
import { defineCommand, UsageError } from "../command";
import { emitModel, type ModelJson, readModelJson } from "../modelFile";
import { visibleNGram } from "../output";

/** 変わった遷移を `context -> token: before => after` の形で数えて stderr に出す。 */
const logTransitionDiff = (
  before: ModelJson["model"],
  after: ModelJson["model"],
): void => {
  const label = (context: string) => visibleNGram(context) || "(BOS)";
  let changed = 0;
  for (const context of new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])) {
    const beforeTokens = before[context] ?? {};
    const afterTokens = after[context] ?? {};
    for (const token of new Set([
      ...Object.keys(beforeTokens),
      ...Object.keys(afterTokens),
    ])) {
      const weightBefore = beforeTokens[token] ?? 0;
      const weightAfter = afterTokens[token] ?? 0;
      if (weightBefore !== weightAfter) {
        console.error(
          `${label(context)} -> ${visibleNGram(token)}: ${weightBefore} => ${weightAfter}`,
        );
        changed++;
      }
    }
  }
  console.error(`changed: ${changed} transitions`);
};

export const decrementPhrase = defineCommand({
  name: "decrement-phrase",
  summary: "weaken (or purge) the transitions of a phrase",
  args: {
    modelPath: { help: "path of the model file" },
    phrase: { help: "phrase whose transitions are weakened" },
  },
  options: {
    delta: {
      type: "string",
      integer: true,
      help: "subtract N from the weights (default 1); not with --purge",
    },
    purge: {
      type: "boolean",
      default: false,
      help: "drop the transitions instead of weakening them",
    },
    "in-place": {
      type: "boolean",
      short: "i",
      default: false,
      help: "write the model back to <modelPath> (default: print to stdout)",
    },
    suffix: {
      type: "string",
      help: "copy <modelPath> to <modelPath>SUFFIX before --in-place",
    },
    delimiter: {
      type: "string",
      short: "d",
      default: " ",
      help: "delimiter inside the phrase",
    },
  },
  run: (args) => {
    const { modelPath, phrase, purge, suffix, delimiter } = args;
    if (purge && args.delta !== undefined) {
      throw new UsageError("--purge and --delta cannot be used together");
    }
    const delta = args.delta === undefined ? 1 : Number(args.delta);
    const tokens = phrase
      .split(delimiter || " ")
      .map((token) => token.trim())
      .filter(Boolean);
    if (tokens.length === 0) {
      throw new UsageError("phrase is empty");
    }
    const model = MarkovChainModel.fromFile(modelPath);
    const before = readModelJson(model).model;
    const updated = model.decrementPhrase(
      tokens,
      purge ? { purge: true } : { delta },
    );
    console.error(
      `decrement-phrase ${purge ? "purge" : `delta=${delta}`} tokens=${JSON.stringify(tokens)}`,
    );
    logTransitionDiff(before, readModelJson(updated).model);
    emitModel({
      modelPath,
      updated,
      inPlace: args["in-place"],
      suffix,
    });
  },
});
