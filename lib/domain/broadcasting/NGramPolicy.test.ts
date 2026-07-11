import { describe, expect, it } from "bun:test";
import { inferNGramSize, inferNGramSizeRaw, INITIAL_COMMENT_NUMBER, initialNGramSize } from "./NGramPolicy";

describe("NGramPolicy", () => {
  it("matches legacy boundaries for representative comment numbers", () => {
    const cases: Array<[number, number]> = [
      [1, 1],
      [10, 1],
      [99, 1],
      [100, 2],
      [999, 3],
      [1000, 4],
      [5000, 5],
    ];
    for (const [no, expected] of cases) {
      expect(inferNGramSize(no)).toBe(expected);
    }
  });

  it("clamps comment numbers below 1 to the same raw as 1", () => {
    expect(inferNGramSizeRaw(0)).toBe(inferNGramSizeRaw(1));
    expect(inferNGramSizeRaw(-5)).toBe(inferNGramSizeRaw(1));
  });

  it("initial size equals size for INITIAL_COMMENT_NUMBER", () => {
    expect(initialNGramSize()).toBe(inferNGramSize(INITIAL_COMMENT_NUMBER));
  });
});
