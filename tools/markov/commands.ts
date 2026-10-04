/**
 * markov CLI のサブコマンド表。
 *
 * 各コマンドは `commands/<name>.ts` に宣言（summary / positionals / options）と
 * 処理だけを書いており、usage・ヘルプ・未知のオプションの検出は宣言から
 * `command.ts` が作る。別のコマンドのオプションを渡しても、宣言に無いので弾かれる。
 *
 * このファイルが持つのは並び順だけ（`--help` の並び順 = オプション表の並び順）。
 * お手本は git の `builtin/<cmd>.c` の `struct option[]`（1 コマンド 1 ファイル）。
 * 設計は `architecture/markov-cli.md` を参照。
 */
import type { Command } from "./command";
import { corpusCommand } from "./commands/corpus";
import { decrementPhraseCommand } from "./commands/decrementPhrase";
import { searchCommand } from "./commands/search";
import { tokensCommand } from "./commands/tokens";
import { transitionsCommand } from "./commands/transitions";
import { unlearnCommand } from "./commands/unlearn";

export {
  corpusCommand,
  decrementPhraseCommand,
  searchCommand,
  tokensCommand,
  transitionsCommand,
  unlearnCommand,
};

/** サブコマンドの表。並び順が `--help` の並び順になる。 */
export const markovCommands: readonly Command[] = [
  corpusCommand,
  unlearnCommand,
  decrementPhraseCommand,
  tokensCommand,
  searchCommand,
  transitionsCommand,
];
