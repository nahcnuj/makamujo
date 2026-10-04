import { describe, expect, it } from "bun:test";

import { UsageError } from "../command";
import { captureOutput, csvRows, modelFixture } from "../testLib";
import { tokens } from "./tokens";

/**
 * `a` は重み 5・行き先 1 個、`b` は重み 1・行き先 2 個、`x` / `y` は行き先側だけ。
 * 並べ替えの 3 通りがそれぞれ違う答えになるようにしている。
 */
const fixture = () =>
  modelFixture("tokens", {
    model: { "": { b: 1, a: 5 }, a: { x: 1 }, b: { x: 1, y: 1 } },
    corpus: [],
  });

/** 1 番目の列（トークン）を並べた並びを返す。 */
const tokensInOrder = (sort?: readonly string[]): string[] => {
  const model = fixture();
  const { stdout } = captureOutput(() =>
    tokens.run(tokens.parse([model.modelPath, ...(sort ?? [])])),
  );
  model.remove();
  const [header, ...rows] = csvRows(stdout);
  expect(header).toEqual(["token", "asFrom", "asToWeight"]);
  return rows.map((row) => row[0] ?? "");
};

/** `--sort` だけを受けるコマンドであることを確かめる。 */
const expectOnlySort = (): void => {
  expect(tokens.usage).toBe("tokens <modelPath> [--sort]");
  expect(Object.keys(tokens.options)).toEqual(["sort"]);
  expect(tokens.parse(["m.json"]).sort).toBe("asToWeight");
  expect(tokens.parse(["m.json", "--sort", "token"]).sort).toBe("token");
};

describe("tokens options", () => {
  it("takes --sort as its only option", expectOnlySort);

  it("takes no option that another command declares", () => {
    for (const option of [
      "--tail",
      "--delta",
      "--purge",
      "--in-place",
      "-i",
      "-d",
    ]) {
      expect(() => tokens.parse(["m.json", option, "token"])).toThrow(
        UsageError,
      );
    }
  });

  it("rejects a --sort outside the declared choices", () => {
    expect(() => tokens.parse(["m.json", "--sort", "nope"])).toThrow(
      "--sort must be one of token, asFrom, asToWeight (got nope)",
    );
  });
});

describe("tokens order", () => {
  it("sorts by asToWeight without --sort, as it does with it", () => {
    expect(tokensInOrder()).toEqual(["a", "x", "b", "y"]);
    expect(tokensInOrder(["--sort", "asToWeight"])).toEqual(tokensInOrder());
  });

  it("sorts by the token itself for --sort token", () => {
    expect(tokensInOrder(["--sort", "token"])).toEqual(["a", "b", "x", "y"]);
  });

  it("sorts by the number of successors for --sort asFrom", () => {
    expect(tokensInOrder(["--sort", "asFrom"])).toEqual(["b", "a", "x", "y"]);
  });

  it("prints the weights next to the token", () => {
    const model = fixture();
    const { stdout } = captureOutput(() =>
      tokens.run(tokens.parse([model.modelPath, "--sort", "token"])),
    );
    expect(csvRows(stdout)).toEqual([
      ["token", "asFrom", "asToWeight"],
      ["a", "1", "5"],
      ["b", "2", "1"],
      ["x", "0", "2"],
      ["y", "0", "1"],
    ]);
    model.remove();
  });
});
