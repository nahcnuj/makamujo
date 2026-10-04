import { defineCommand } from "../command";
import { loadModel, printCsv, visible } from "../shared";

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
