#!/usr/bin/env bun
/**
 * markov CLI の入口。処理はここには書かない。
 *
 * - 1 コマンド 1 ファイルで宣言する（`commands/<name>.ts`）。表の並び順だけ
 *   `commands.ts` が持つ。
 * - 解析・usage・ヘルプ・終了コードは `command.ts` が宣言から作る。
 * - お手本は **git**（`builtin/<cmd>.c` の `struct option[]` と
 *   `parse-options.c` の `parse_options()`）。受理するオプションは宣言した
 *   コマンドのものだけで、別のコマンドのオプションは黙って無視しない。
 *
 * 設計（オプション表・契約・お手本との対応）は `architecture/markov-cli.md`。
 */
import { dispatch } from "./command";
import { markovCommands } from "./commands";

dispatch(markovCommands, Bun.argv.slice(2));
