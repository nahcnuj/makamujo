const jaJP = new Intl.Locale("ja-JP");

/**
 * Pick a reply topic from comment text: longest grapheme-length word segments;
 * ties broken by random among candidates.
 * Default RNG is Math.random (behavior-preserving).
 */
export const pickTopic = (
  text: string,
  random: () => number = Math.random,
): string | undefined => {
  const words = Array.from(
    new Intl.Segmenter(jaJP, { granularity: "word" }).segment(text),
  ).map(({ segment }) => segment);
  const cands = words.reduce<string[]>(
    (prev, s) => {
      const a = [...s].length;
      const b = [...(prev[0] ?? "")].length;
      return a > b ? [s] : a === b ? [...prev, s] : prev;
    },
    [""],
  );
  return cands.at(Math.floor(random() * cands.length));
};
