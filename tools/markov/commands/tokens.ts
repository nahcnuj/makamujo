/**
 * `bun run markov tokens <modelPath> [--sort]`
 * トークンごとの統計を CSV で出す。
 */
import { MarkovChainModel } from "../../../lib/MarkovChainModel";
import { defineCommand } from "../command";
import { printCsv, visibleNGram } from "../output";

export const tokens = defineCommand({
  name: "tokens",
  summary: "per-token statistics as CSV",
  args: {
    modelPath: { help: "path of the model file" },
  },
  options: {
    sort: {
      type: "string",
      default: "asToWeight",
      choices: ["token", "asFrom", "asToWeight"],
      help: "column to sort by",
    },
  },
  run: ({ modelPath, sort }) => {
    const stats = [...MarkovChainModel.fromFile(modelPath).tokenStats()];
    if (sort === "token") {
      stats.sort((a, b) => a.token.localeCompare(b.token, "ja"));
    } else if (sort === "asFrom") {
      stats.sort((a, b) => b.asFrom - a.asFrom);
    } else {
      stats.sort((a, b) => b.asToWeight - a.asToWeight);
    }
    printCsv(
      ["token", "asFrom", "asToWeight"],
      stats.map((stat) => [
        visibleNGram(stat.token),
        stat.asFrom,
        stat.asToWeight,
      ]),
    );
  },
});
