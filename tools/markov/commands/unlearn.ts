/**
 * `bun run markov unlearn <modelPath> <n> [-i] [--suffix]`
 * 末尾から n 番目の学習文（1 = 最新）を消す。
 */
import { MarkovChainModel } from "../../../lib/MarkovChainModel";
import { defineCommand, UsageError } from "../command";
import { emitModel } from "../modelFile";

export const unlearn = defineCommand({
  name: "unlearn",
  summary: "drop the n-th corpus entry from the end (1 = newest)",
  args: {
    modelPath: { help: "path of the model file" },
    n: { help: "1-based index from the newest entry", integer: true },
  },
  options: {
    "in-place": {
      type: "boolean",
      short: "i",
      default: false,
      help: "write the model back to <modelPath> (default: print to stdout)",
    },
    suffix: {
      type: "string",
      help: "copy <modelPath> to <modelPath>SUFFIX before --in-place",
    },
  },
  run: ({ modelPath, n, suffix, "in-place": inPlace }) => {
    const count = Number(n);
    const model = MarkovChainModel.fromFile(modelPath);
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
    emitModel({ modelPath, updated, inPlace, suffix });
  },
});
