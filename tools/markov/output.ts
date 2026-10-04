/**
 * 人が読む形で出すための出力。CSV と n-gram 区切りの表示だけを持つ。
 * オプションの宣言はコマンドごとのファイル（`commands/<name>.ts`）にある。
 */

/** n-gram の区切り `\0` を `/` に見せる。 */
export const visibleNGram = (text: string): string =>
  text.replaceAll("\u0000", "/");

const csvEscape = (value: string | number): string => {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** CSV を 1 行ずつ出す（引用符が必要な値だけ `"` で囲む）。 */
export const printCsv = (
  header: readonly (string | number)[],
  rows: readonly (readonly (string | number)[])[],
): void => {
  console.log(header.map(csvEscape).join(","));
  for (const row of rows) {
    console.log(row.map(csvEscape).join(","));
  }
};
