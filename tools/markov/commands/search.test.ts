import { describe, expect, it } from "bun:test";

import { UsageError } from "../command";
import { captureOutput, csvRows, modelFixture } from "../testLib";
import { search } from "./search";

/** n-gram のトークン（`\0` 区切り）を 1 つ持たせたモデル。 */
const fixture = () =>
  modelFixture("search", {
    model: {
      "": { パンティー: 1 },
      ["ベージュ" + String.fromCharCode(0) + "パンティー"]: { "。": 2 },
    },
    corpus: [],
  });

/** 検索したときの CSV（ヘッダー込み）を返す。 */
const searchRows = (query: string): string[][] => {
  const model = fixture();
  const { stdout } = captureOutput(() =>
    search.run(search.parse([model.modelPath, query])),
  );
  model.remove();
  return csvRows(stdout);
};

/** `--help` 以外のオプションを持たないコマンドであることを確かめる。 */
const expectNoOptions = (): void => {
  expect(search.usage).toBe("search <modelPath> <query>");
  expect(Object.keys(search.options)).toEqual([]);
  expect(search.parse(["m.json", "beige"]).query).toBe("beige");
};

describe("search options", () => {
  it("takes no option but --help", expectNoOptions);

  it("takes no option that another command declares", () => {
    for (const option of [
      "--tail",
      "--sort",
      "--delta",
      "--purge",
      "--in-place",
      "-i",
      "-d",
    ]) {
      expect(() => search.parse(["m.json", "query", option, "2"])).toThrow(
        UsageError,
      );
    }
  });
});

describe("search output", () => {
  it("lists the tokens containing the query", () => {
    expect(searchRows("パンティー")).toEqual([
      ["token", "asFrom", "asToWeight"],
      ["パンティー", "0", "1"],
      ["ベージュ/パンティー", "1", "0"],
    ]);
  });

  it("keeps the n-gram separator out of the output", () => {
    const model = fixture();
    const { stdout } = captureOutput(() =>
      search.run(search.parse([model.modelPath, "パンティー"])),
    );
    expect(stdout.includes(String.fromCharCode(0))).toBe(false);
    model.remove();
  });

  it("prints only the header when nothing matches", () => {
    expect(searchRows("該当なし")).toEqual([["token", "asFrom", "asToWeight"]]);
  });
});
