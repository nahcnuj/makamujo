import { describe, expect, it } from "bun:test";

import { UsageError } from "../command";
import { captureOutput, csvRows, modelFixture } from "../testLib";
import { transitions } from "./transitions";

/** `パンティー` を n-gram の文脈として持つモデル。 */
const fixture = () =>
  modelFixture("transitions", {
    model: {
      "": { パンティー: 5 },
      パンティー: { "。": 10 },
      ["ベージュ" + String.fromCharCode(0) + "パンティー"]: { "。": 9 },
      の: { パンティー: 4 },
    },
    corpus: [],
  });

/** 遷移を調べたときの CSV（ヘッダー込み）を返す。 */
const transitionRows = (...argv: readonly string[]): string[][] => {
  const model = fixture();
  const { stdout } = captureOutput(() =>
    transitions.run(transitions.parse([model.modelPath, ...argv])),
  );
  model.remove();
  return csvRows(stdout);
};

/** `-d` だけを受けるコマンドであることを確かめる。 */
const expectOnlyDelimiter = (): void => {
  expect(transitions.usage).toBe("transitions <modelPath> <word> [-d]");
  expect(Object.keys(transitions.options)).toEqual(["delimiter"]);
  expect(transitions.parse(["m.json", "word"]).delimiter).toBe(" ");
  expect(transitions.parse(["m.json", "a/b", "-d/"]).delimiter).toBe("/");
};

describe("transitions options", () => {
  it("takes -d as its only option", expectOnlyDelimiter);

  it("takes no option that another command declares", () => {
    for (const option of ["--tail", "--sort", "--delta", "--purge", "-i"]) {
      expect(() => transitions.parse(["m.json", "word", option, "2"])).toThrow(
        UsageError,
      );
    }
  });
});

describe("transitions output", () => {
  it("lists the contexts holding the word and the words leading to it", () => {
    expect(transitionRows("パンティー")).toEqual([
      ["direction", "context", "other", "weight"],
      ["from", "パンティー", "。", "10"],
      ["from", "ベージュ/パンティー", "。", "9"],
      ["to", "", "パンティー", "5"],
      ["to", "の", "パンティー", "4"],
    ]);
  });

  it("looks the word up as one n-gram with -d", () => {
    expect(transitionRows("ベージュ/パンティー", "-d/")).toEqual([
      ["direction", "context", "other", "weight"],
      ["from", "ベージュ/パンティー", "。", "9"],
    ]);
  });

  it("finds nothing for a phrase written without -d", () => {
    expect(transitionRows("ベージュ/パンティー")).toEqual([
      ["direction", "context", "other", "weight"],
    ]);
  });
});
