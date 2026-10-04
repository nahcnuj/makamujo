import { defineCommand, UsageError } from "../command";
import { emitModel, loadModel, positiveInteger } from "../shared";
import { IN_PLACE_OPTIONS } from "./options";

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
