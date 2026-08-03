const jaJP = new Intl.Locale("ja-JP");

/** 単語セグメントに分割（呼び出し側で候補を組み立てる用） */
export const segmentWords = (text: string): string[] =>
  Array.from(new Intl.Segmenter(jaJP, { granularity: "word" }).segment(text))
    .map(({ segment }) => segment)
    .filter((s) => s.trim().length > 0);

/**
 * Pick a reply topic from comment text: longest grapheme-length word segments;
 * ties broken by random among candidates.
 * Default RNG is Math.random (behavior-preserving).
 */
export const pickTopic = (text: string, random: () => number = Math.random): string | undefined => {
  const words = segmentWords(text);
  if (words.length === 0) return undefined;

  const cands = words.reduce<string[]>((prev, s) => {
    const a = [...s].length;
    const b = [...(prev[0] ?? "")].length;
    return a > b ? [s] : a === b ? [...prev, s] : prev;
  }, []);

  return pickRandomFrom(cands, random);
};

/**
 * 乱択: 候補を引数で受け取り、一様に1つ選ぶ。
 * ゲーム内ニュース起点の発話などで使用。
 */
export const pickRandomFrom = <T>(
  candidates: readonly T[],
  random: () => number = Math.random,
): T | undefined => {
  if (candidates.length === 0) return undefined;
  return candidates[Math.floor(random() * candidates.length)];
};
