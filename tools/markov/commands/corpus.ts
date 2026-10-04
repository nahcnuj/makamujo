import { defineCommand } from "../command";
import { loadModel, positiveInteger, readModelJson } from "../shared";

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
