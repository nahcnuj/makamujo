/**
 * `bun run markov search <modelPath> <query>`
 * query を含むトークンを CSV で出す。
 */
import { MarkovChainModel } from "../../../lib/MarkovChainModel";
import { defineCommand } from "../command";
import { printCsv, visibleNGram } from "../output";

export const search = defineCommand({
  name: "search",
  summary: "tokens containing the query, as CSV",
  args: {
    modelPath: { help: "path of the model file" },
    query: { help: "substring to look for" },
  },
  options: {},
  run: ({ modelPath, query }) => {
    const hits = MarkovChainModel.fromFile(modelPath)
      .tokenStats()
      .filter((stat) => stat.token.includes(query));
    printCsv(
      ["token", "asFrom", "asToWeight"],
      hits.map((stat) => [
        visibleNGram(stat.token),
        stat.asFrom,
        stat.asToWeight,
      ]),
    );
  },
});
