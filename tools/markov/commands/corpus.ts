/**
 * `bun run markov corpus <modelPath> [--tail]`
 * 学習した文を新しい順に一覧する（1 = 最新）。
 */
import { MarkovChainModel } from "../../../lib/MarkovChainModel";
import { defineCommand } from "../command";
import { readModelJson } from "../modelFile";

export const corpus = defineCommand({
  name: "corpus",
  summary: "list corpus entries (1 = newest)",
  args: {
    modelPath: { help: "path of the model file" },
  },
  options: {
    tail: {
      type: "string",
      integer: true,
      help: "list only the newest N entries",
    },
  },
  run: ({ modelPath, tail }) => {
    const entries =
      readModelJson(MarkovChainModel.fromFile(modelPath)).corpus ?? [];
    const listed = tail === undefined ? entries : entries.slice(-Number(tail));
    listed.forEach((entry, index) => {
      console.log(`${listed.length - index}\t${entry}`);
    });
  },
});
