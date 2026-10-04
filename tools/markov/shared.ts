/**
 * サブコマンドの処理で共有する、モデル入出力と表示の寄り道。
 * 引数の扱い（宣言・解析・usage）は `command.ts` にある。
 */
import { copyFileSync, writeFileSync } from "node:fs";

import { MarkovChainModel } from "../../lib/MarkovChainModel";
import { CliError, errorMessage, UsageError } from "./command";

/** `MarkovChainModel` が書き出す JSON の形。差分表示と corpus の一覧で読む。 */
export type ModelJson = {
  /** 文脈ごとの遷移の重み（`""` は文頭）。 */
  model: Record<string, Record<string, number>>;
  /** 学習した文。末尾が新しい。 */
  corpus?: string[];
};

/** モデルの JSON 表現を読む。 */
export const readModelJson = (model: MarkovChainModel): ModelJson =>
  JSON.parse(model.toJSON());

/** モデルファイルを読む。読めなければ CliError（usage は添えない）。 */
export const loadModel = (path: string): MarkovChainModel => {
  try {
    return MarkovChainModel.fromFile(path);
  } catch (error) {
    throw new CliError(`failed to load model: ${path}: ${errorMessage(error)}`);
  }
};

/** 正の整数として読む。`1` 未満や数字以外なら UsageError。 */
export const positiveInteger = (label: string, value: string): number => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new UsageError(`${label} must be a positive integer, got ${value}`);
  }
  return parsed;
};

/** n-gram の区切り `\0` を `/` に見せる。 */
export const visible = (text: string): string => text.replaceAll("\u0000", "/");

/** フレーズを区切りで割る。空の要素は落とす。 */
export const splitPhrase = (phrase: string, delimiter: string): string[] =>
  phrase
    .split(delimiter || " ")
    .map((part) => part.trim())
    .filter(Boolean);

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

/** 変更された遷移を `context -> token: before => after` の形で数えて出す。 */
export const logTransitionDiff = (
  before: ModelJson["model"],
  after: ModelJson["model"],
): void => {
  const label = (context: string) => visible(context) || "(BOS)";
  let changed = 0;
  for (const context of new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])) {
    const beforeTokens = before[context] ?? {};
    const afterTokens = after[context] ?? {};
    for (const token of new Set([
      ...Object.keys(beforeTokens),
      ...Object.keys(afterTokens),
    ])) {
      const weightBefore = beforeTokens[token] ?? 0;
      const weightAfter = afterTokens[token] ?? 0;
      if (weightBefore !== weightAfter) {
        console.error(
          `${label(context)} -> ${visible(token)}: ${weightBefore} => ${weightAfter}`,
        );
        changed++;
      }
    }
  }
  console.error(`changed: ${changed} transitions`);
};

/**
 * 更新後のモデルを返す。
 * `inPlace` ならファイルへ書き戻し、`suffix` が空でなければバックアップを先に作る。
 * 書き戻さないときは stdout に JSON を出す（パイプに繋ぐため）。
 */
export const emitModel = (
  modelPath: string,
  updated: MarkovChainModel,
  inPlace: boolean,
  suffix: string,
): void => {
  if (!inPlace) {
    process.stdout.write(updated.toJSON());
    if (process.stdout.isTTY) {
      process.stdout.write("\n");
    }
    return;
  }
  if (suffix) {
    const backupPath = modelPath + suffix;
    copyFileSync(modelPath, backupPath);
    console.error(`backup: ${backupPath}`);
  }
  writeFileSync(modelPath, updated.toJSON(), "utf8");
  console.error(`wrote: ${modelPath}`);
};
