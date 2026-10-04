/**
 * markov CLI のサブコマンド表。
 *
 * 1 コマンド 1 ファイル（git の `builtin/<cmd>.c` と同じ形）で、各ファイルが
 * そのコマンドのオプション表（`options`）と処理（`run`）を持つ。ここは表の
 * 並び順だけ（並び順が `bun run markov --help` の並び順になる）。
 *
 * `bun run markov <command> --help` に出る表は各コマンドの `options` から作られる。
 */
import type { Command } from "./command";
import { corpus } from "./commands/corpus";
import { decrementPhrase } from "./commands/decrementPhrase";
import { search } from "./commands/search";
import { tokens } from "./commands/tokens";
import { transitions } from "./commands/transitions";
import { unlearn } from "./commands/unlearn";

export const markovCommands: readonly Command[] = [
  corpus,
  unlearn,
  decrementPhrase,
  tokens,
  search,
  transitions,
];
