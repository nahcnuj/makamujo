import { describe, expect, it, spyOn } from "bun:test";

import { printCsv, visibleNGram } from "./output";

/** n-gram の区切り。 */
const NGRAM_SEPARATOR = String.fromCharCode(0);

describe("visibleNGram", () => {
  it("shows the n-gram separator as a slash", () => {
    expect(visibleNGram(["a", "b"].join(NGRAM_SEPARATOR))).toBe("a/b");
    expect(visibleNGram("a")).toBe("a");
  });
});

describe("printCsv", () => {
  /** 出力する行を全部取る。 */
  const printed = (
    header: readonly (string | number)[],
    rows: readonly (readonly (string | number)[])[],
  ): string[] => {
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((line) => {
      lines.push(String(line));
    });
    try {
      printCsv(header, rows);
    } finally {
      log.mockRestore();
    }
    return lines;
  };

  it("prints the header and one line per row", () => {
    expect(
      printed(
        ["token", "weight"],
        [
          ["a", 1],
          ["b", 2],
        ],
      ),
    ).toEqual(["token,weight", "a,1", "b,2"]);
  });

  it("quotes only the values that need it", () => {
    expect(printed(["x"], [["a,b"], ['say "hi"'], ["plain"]])).toEqual([
      "x",
      '"a,b"',
      '"say ""hi"""',
      "plain",
    ]);
  });
});
