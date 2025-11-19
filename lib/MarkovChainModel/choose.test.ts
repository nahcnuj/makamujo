import { describe, expect, jest, test } from "bun:test";
import { choose } from "./choose";

describe.each<[[string, number][], [number, string][]]>([
  [
    [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ],
    [
      [0, 'a'],
      [0.5, 'a'],
      [1, 'b'],
      [1.5, 'b'],
      [2, 'b'],
      [3, 'c'],
      [5.9, 'c'],
      [6, 'c'],
    ],
  ],
])('choose a word from weighted candidates: %o', (cands: [string, number][], cases) => {
  test.each(cases)('w = %p -> %p', (w, want) => {
    expect(choose(cands, w)).toBe(want);
  });
});
