import { defineCommand } from "../command";
import { loadModel, printCsv, splitPhrase, visible } from "../shared";
import { DELIMITER_OPTION } from "./options";

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
