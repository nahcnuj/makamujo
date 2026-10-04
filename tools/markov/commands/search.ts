import { defineCommand } from "../command";
import { loadModel, printCsv, visible } from "../shared";

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
