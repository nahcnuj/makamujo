/**
 * Selects a candidate string from a list of weighted candidates by scanning
 * cumulative weights and returning the candidate whose weight push the
 * cumulative sum strictly above the provided threshold `w`.
 *
 * @param cands Array of pairs [label, weight]. Each element is a tuple
 *              where the first item is the candidate string and the
 *              second is its numeric weight.
 * @param w     Threshold used to pick a candidate from the cumulative
 *              weight distribution. Intended to be in the range
 *              [0, totalWeight), where totalWeight is the sum of all
 *              weights in `cands`.
 *
 * @returns The selected candidate string.
 *          - If `cands` is empty the function returns the empty string.
 *          - If `w` is negative the function returns the empty string (no
 *            candidate is selected).
 *          - If `w` is greater than or equal to the sum of all weights the
 *            function returns the last candidate's label.
 *
 * @remarks
 * - The function does not validate inputs: weights are expected to be
 *   non‑negative numbers and `w` is expected to be a finite number.
 *   Supplying negative weights or non‑finite values may produce
 *   unintuitive results.
 * - Time complexity: O(n), where n is `cands.length`.
 *
 * @example
 * Given candidates [['a', 1], ['b', 2], ['c', 3]]
 * cumulative weights: 1, 3, 6
 * - w = 0.5  -> 'a' (0.5 < 1)
 * - w = 1.5  -> 'b' (1.5 < 3 = 1+2)
 * - w = 5.9  -> 'c' (5.9 < 6 = 1+2+3)
 * - w >= 6.0 -> 'c' ( w >= 6 = 1+2+3)
 */
export const choose = (cands: [string, number][], w: number): string => cands.reduce(([current, acc], [next, weight]) => {
  if (acc > w) {
    return [current, acc];
  }
  return [next, acc + weight];
}, ['', 0])[0];

