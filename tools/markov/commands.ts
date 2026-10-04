/**
 * markov CLI のサブコマンド表。
 *
 * 各コマンドは「宣言（summary / positionals / options）と処理」だけを書いており、
 * usage・ヘルプ・未知のオプションの検出は宣言から `command.ts` が作る。
 * 別のコマンドのオプションを渡しても、宣言に無いので弾かれる。
 */
import { type Command, defineCommand, UsageError } from "./command";
import {
  emitModel,
  loadModel,
  logTransitionDiff,
  positiveInteger,
  printCsv,
  readModelJson,
  splitPhrase,
  visible,
} from "./shared";

/** 結果を書き戻す系（`unlearn` と `decrement-phrase` が共通で使う）。 */
const IN_PLACE_OPTIONS = {
  "in-place": {
    type: "boolean",
    short: "i",
    default: false,
    inlineSuffix: "suffix",
    description: "write the model back; -iSUFFIX keeps a backup first",
  },
  suffix: {
    type: "string",
    default: "",
    hidden: true,
    description: "backup suffix given inline after -i",
  },
} as const;

/** フレーズを区切るときの `-d`（`decrement-phrase` と `transitions` が共通で使う）。 */
const DELIMITER_OPTION = {
  delimiter: {
    type: "string",
    short: "d",
    default: " ",
    value: "DELIM",
    description: "delimiter inside the phrase",
  },
} as const;

export const corpusCommand = defineCommand({
  name: "corpus",
  summary: "list corpus entries (1 = newest)",
  positionals: {
    modelPath: "path of the model file",
  },
  options: {
    tail: {
      type: "string",
      value: "N",
      description: "list only the newest N entries",
    },
  },
  run: (args) => {
    const { modelPath, tail } = args;
    const newestFirst =
      tail === undefined ? undefined : positiveInteger("--tail", tail);
    const corpus = readModelJson(loadModel(modelPath)).corpus ?? [];
    const entries =
      newestFirst === undefined ? corpus : corpus.slice(-newestFirst);
    entries.forEach((entry, index) => {
      console.log(`${entries.length - index}\t${entry}`);
    });
  },
});

export const unlearnCommand = defineCommand({
  name: "unlearn",
  summary: "drop the n-th corpus entry from the end (1 = newest)",
  positionals: {
    modelPath: "path of the model file",
    n: "1-based index from the newest entry",
  },
  options: IN_PLACE_OPTIONS,
  run: ({ modelPath, n, suffix, "in-place": inPlace }) => {
    const count = positiveInteger("n", n);
    const model = loadModel(modelPath);
    const text = model.corpusFromEnd(count);
    if (text === undefined) {
      throw new UsageError(
        `n=${count} out of range (corpus length ${model.corpusLength()})`,
      );
    }
    const updated = model.unlearnFromEnd(count);
    console.error(`unlearn n=${count} from-end text=${JSON.stringify(text)}`);
    console.error(
      `corpus: ${model.corpusLength()} => ${updated.corpusLength()}`,
    );
    emitModel(modelPath, updated, inPlace, suffix);
  },
});

export const decrementPhraseCommand = defineCommand({
  name: "decrement-phrase",
  summary: "weaken (or purge) the transitions of a phrase",
  positionals: {
    modelPath: "path of the model file",
    phrase: "phrase whose transitions are weakened",
  },
  options: {
    delta: {
      type: "string",
      value: "N",
      description: "subtract N from the weights (default 1); not with --purge",
    },
    purge: {
      type: "boolean",
      default: false,
      description: "drop the transitions instead of weakening them",
    },
    ...IN_PLACE_OPTIONS,
    ...DELIMITER_OPTION,
  },
  run: (args) => {
    const {
      modelPath,
      phrase,
      purge,
      suffix,
      delimiter,
      "in-place": inPlace,
    } = args;
    if (purge && args.delta !== undefined) {
      throw new UsageError("--purge and --delta cannot be used together");
    }
    const delta =
      args.delta === undefined ? 1 : positiveInteger("--delta", args.delta);
    const tokens = splitPhrase(phrase, delimiter);
    if (tokens.length === 0) {
      throw new UsageError("phrase is empty");
    }
    const model = loadModel(modelPath);
    const before = readModelJson(model).model;
    const updated = model.decrementPhrase(
      tokens,
      purge ? { purge: true } : { delta },
    );
    console.error(
      `decrement-phrase ${purge ? "purge" : `delta=${delta}`} tokens=${JSON.stringify(tokens)}`,
    );
    logTransitionDiff(before, readModelJson(updated).model);
    emitModel(modelPath, updated, inPlace, suffix);
  },
});

export const tokensCommand = defineCommand({
  name: "tokens",
  summary: "per-token statistics as CSV",
  positionals: {
    modelPath: "path of the model file",
  },
  options: {
    sort: {
      type: "string",
      default: "asToWeight",
      choices: ["token", "asFrom", "asToWeight"],
      description: "column to sort by",
    },
  },
  run: ({ modelPath, sort }) => {
    const stats = [...loadModel(modelPath).tokenStats()];
    if (sort === "token") {
      stats.sort((a, b) => a.token.localeCompare(b.token, "ja"));
    } else if (sort === "asFrom") {
      stats.sort((a, b) => b.asFrom - a.asFrom);
    } else {
      stats.sort((a, b) => b.asToWeight - a.asToWeight);
    }
    printCsv(
      ["token", "asFrom", "asToWeight"],
      stats.map((stat) => [visible(stat.token), stat.asFrom, stat.asToWeight]),
    );
  },
});

export const searchCommand = defineCommand({
  name: "search",
  summary: "tokens containing the query, as CSV",
  positionals: {
    modelPath: "path of the model file",
    query: "substring to look for",
  },
  options: {},
  run: ({ modelPath, query }) => {
    const hits = loadModel(modelPath)
      .tokenStats()
      .filter((stat) => stat.token.includes(query));
    printCsv(
      ["token", "asFrom", "asToWeight"],
      hits.map((stat) => [visible(stat.token), stat.asFrom, stat.asToWeight]),
    );
  },
});

export const transitionsCommand = defineCommand({
  name: "transitions",
  summary: "transitions around a word as CSV",
  positionals: {
    modelPath: "path of the model file",
    word: "word or phrase to look up",
  },
  options: DELIMITER_OPTION,
  run: ({ modelPath, word, delimiter }) => {
    const model = loadModel(modelPath);
    const phrase = splitPhrase(word, delimiter);
    const transitions = model.transitionsOf(phrase.join(" "));
    const normalized = phrase.join("\u0000");
    printCsv(
      ["direction", "context", "other", "weight"],
      [
        ...transitions.fromContexts.map(
          ({ context, next, weight }) =>
            ["from", visible(context), next, weight] as const,
        ),
        ...transitions.asTo.map(
          ({ from, weight }) =>
            ["to", visible(from), visible(normalized), weight] as const,
        ),
      ],
    );
  },
});

/** サブコマンドの表。並び順が `--help` の並び順になる。 */
export const markovCommands: readonly Command[] = [
  corpusCommand,
  unlearnCommand,
  decrementPhraseCommand,
  tokensCommand,
  searchCommand,
  transitionsCommand,
];
