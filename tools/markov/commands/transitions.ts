/**
 * `bun run markov transitions <modelPath> <word> [-d]`
 * 単語の周辺の遷移を CSV で出す（`-d` でフレーズの区切りを指定できる）。
 */
import { MarkovChainModel } from "../../../lib/MarkovChainModel";
import { defineCommand } from "../command";
import { printCsv, visibleNGram } from "../output";

export const transitions = defineCommand({
  name: "transitions",
  summary: "transitions around a word as CSV",
  args: {
    modelPath: { help: "path of the model file" },
    word: { help: "word or phrase to look up" },
  },
  options: {
    delimiter: {
      type: "string",
      short: "d",
      default: " ",
      help: "delimiter inside the phrase",
    },
  },
  run: ({ modelPath, word, delimiter }) => {
    const tokens = word
      .split(delimiter || " ")
      .map((token) => token.trim())
      .filter(Boolean);
    // モデルはフレーズを `\0` 区切りの n-gram キーとして持つ。
    const key = tokens.join("\u0000");
    const { asTo, fromContexts } =
      MarkovChainModel.fromFile(modelPath).transitionsOf(key);
    printCsv(
      ["direction", "context", "other", "weight"],
      [
        ...fromContexts.map(
          ({ context, next, weight }) =>
            ["from", visibleNGram(context), next, weight] as const,
        ),
        ...asTo.map(
          ({ from, weight }) =>
            ["to", visibleNGram(from), visibleNGram(key), weight] as const,
        ),
      ],
    );
  },
});
