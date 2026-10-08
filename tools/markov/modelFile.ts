/**
 * モデルファイルの出入り。読み込み・書き戻しだけを持つ。
 * オプションの宣言はコマンドごとのファイル（`commands/<name>.ts`）にある。
 */
import { copyFileSync, writeFileSync } from "node:fs";

import type { MarkovChainModel } from "../../lib/MarkovChainModel";

/** `MarkovChainModel` が書き出す JSON の形。corpus の一覧と遷移の差分表示で読む。 */
export type ModelJson = {
  /** 文脈ごとの遷移の重み（`""` は文頭）。 */
  model: Record<string, Record<string, number>>;
  /** 学習した文。末尾が新しい。 */
  corpus?: string[];
};

/** モデルの JSON 表現を読む。 */
export const readModelJson = (model: MarkovChainModel): ModelJson =>
  JSON.parse(model.toJSON());

/**
 * 更新後のモデルを出す。
 * `inPlace` ならファイルへ書き戻し、`suffix` があればバックアップを先に作る。
 * 書き戻さないときは stdout に JSON を出す（パイプに繋ぐため）。
 */
export const emitModel = ({
  modelPath,
  updated,
  inPlace,
  suffix,
}: {
  readonly modelPath: string;
  readonly updated: MarkovChainModel;
  readonly inPlace: boolean;
  readonly suffix: string | undefined;
}): void => {
  if (!inPlace) {
    process.stdout.write(updated.toJSON());
    if (process.stdout.isTTY) {
      process.stdout.write("\n");
    }
    return;
  }
  if (suffix !== undefined) {
    const backupPath = modelPath + suffix;
    copyFileSync(modelPath, backupPath);
    console.error(`backup: ${backupPath}`);
  }
  writeFileSync(modelPath, updated.toJSON(), "utf8");
  console.error(`wrote: ${modelPath}`);
};
