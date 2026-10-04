#!/usr/bin/env bun
/**
 * markov CLI の入口。処理はここには書かない。
 *
 * `bun run markov <command> [options]` の 1 本的行と、
 * サブコマンド表（`commands.ts`）を `dispatch` に渡すだけ。
 *
 * 契約（コマンドごとのオプション表・usage・終了コード）は
 * `architecture/markov-cli.md`。
 */
import { dispatch } from "./command";
import { markovCommands } from "./commands";

dispatch(markovCommands, Bun.argv.slice(2));
