import { defineCommand, UsageError } from "../command";
import {
  emitModel,
  loadModel,
  logTransitionDiff,
  positiveInteger,
  readModelJson,
  splitPhrase,
} from "../shared";
import { DELIMITER_OPTION, IN_PLACE_OPTIONS } from "./options";

export const decrementPhraseCommand = defineCommand({
  name: "decrement-phrase",
  summary: "weaken (or purge) the transitions of a phrase",
  positionals: {
    modelPath: "path of the model file",
    phrase: "phrase whose transitions are weakened",
  },
  options: {
    delta: {
      type: "string",
      value: "N",
      description: "subtract N from the weights (default 1); not with --purge",
    },
    purge: {
      type: "boolean",
      default: false,
      description: "drop the transitions instead of weakening them",
    },
    ...IN_PLACE_OPTIONS,
    ...DELIMITER_OPTION,
  },
  run: (args) => {
    const {
      modelPath,
      phrase,
      purge,
      suffix,
      delimiter,
      "in-place": inPlace,
    } = args;
    if (purge && args.delta !== undefined) {
      throw new UsageError("--purge and --delta cannot be used together");
    }
    const delta =
      args.delta === undefined ? 1 : positiveInteger("--delta", args.delta);
    const tokens = splitPhrase(phrase, delimiter);
    if (tokens.length === 0) {
      throw new UsageError("phrase is empty");
    }
    const model = loadModel(modelPath);
    const before = readModelJson(model).model;
    const updated = model.decrementPhrase(
      tokens,
      purge ? { purge: true } : { delta },
    );
    console.error(
      `decrement-phrase ${purge ? "purge" : `delta=${delta}`} tokens=${JSON.stringify(tokens)}`,
    );
    logTransitionDiff(before, readModelJson(updated).model);
    emitModel(modelPath, updated, inPlace, suffix);
  },
});
