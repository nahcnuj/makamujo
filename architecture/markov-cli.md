# markov CLI の設計

`bun run markov <command> [options]` のサブコマンド CLI。実装は `tools/markov/`。

## お手本: git のサブコマンド（`builtin/parse-options.c`）

git の `parse_options()` は、**そのコマンドの `builtin/<cmd>.c` が宣言した
`struct option[]` だけを見る**。宣言に無いオプションは

```text
error: unknown option `tail'
usage: git corpus <modelPath> [<n>]
```

のように、そのコマンドの usage だけを添えてエラーになり、`git corpus --help` に
`corpus` のオプションしか出ない。markov CLI も同じ契約にする（issue #534 の
`transitions --tail 3` が黙って無視されていたのは、全コマンドが 1 つの
オプション表を共有していたため）。

借りるのは「オプション表をコマンドごとに持つ」という**構造**で、git の実装
（C の getopt）そのものではない。対応表:

| git | この CLI |
|---|---|
| `builtin/<cmd>.c` の `struct option[] options[]` | `commands/<name>.ts` の `options`（`defineCommand` に書く表） |
| usage 文字列 | `positionals` と `options` から作る `usage` |
| `parse_options()` | `parseCommandArgs`（Node の `parseArgs` を `strict: true` で使う） |
| `usage_with_options()` | `helpOf` / `helpText` |
| `run_argv()`（コマンドを選んでパサへ渡す） | `dispatch` |
| `OPT__HIDDEN`（説明も usage にも出ない内部用オプション） | `description` を書かないオプション（`--suffix` がこれ） |
| `-i<suffix>` のような独自表記 | `-i.bak` を `-i --suffix .bak` に展開（`hasInlineSuffix`） |

## オプション表

**正は各コマンドの `options` 宣言**（上の対応表の 1 行目）。下の表は
`bun run markov --help` に出る内容で、`tools/markov/commands.test.ts` の `TABLE`
が同じ文字列を固定している。

| コマンド | 位置引数 | オプション | 宣言 |
|---|---|---|---|
| `corpus` | `modelPath` | `--tail N` | `commands/corpus.ts` |
| `unlearn` | `modelPath`, `n` | `-i/--in-place`, `--suffix`※ | `commands/unlearn.ts` |
| `decrement-phrase` | `modelPath`, `phrase` | `--delta N`, `--purge`, `-i/--in-place`, `--suffix`※, `-d/--delimiter` | `commands/decrementPhrase.ts` |
| `tokens` | `modelPath` | `--sort token\|asFrom\|asToWeight` | `commands/tokens.ts` |
| `search` | `modelPath`, `query` | （`--help` のみ） | `commands/search.ts` |
| `transitions` | `modelPath`, `word` | `-d/--delimiter` | `commands/transitions.ts` |

※ `--suffix` は `-i.bak` の受け皿で内部用（`description` が無い）。受理されるが
usage・ヘルプには出ない。

## 契約

- 受理するオプションは、そのコマンドの `options` 宣言だけ。`parseArgs` の
  `strict: true` がそれ以外をエラーにし、`dispatch` がそのコマンドの usage 1 行を
  添えて終了コード 1 にする（他のコマンドのオプションは黙って無視しない）。
- `--help` は全コマンド共通の指定。`markov --help` が全表、`markov <command> --help`
  がそのコマンドだけの usage・引数・オプションを出す。
- `UsageError`（引数が間違っている）だけ usage を添える。`CliError`（モデルを読めない
  等）は添えない。どちらも終了コード 1。
- `--delta` は既定値を宣言しないので「未指定」と `1` を区別できる。`--purge` との排他は
  `run` が `UsageError` にする（引数の組み合わせは表では表せないため）。
- `--sort` の値は `choices` に宣言してあり、宣言に無い値は `UsageError`。
  usage には `token|asFrom|asToWeight` と出る。

## ファイル

| ファイル | 役割 |
|---|---|
| `tools/markov/cli.ts` | 入口。`dispatch(markovCommands, Bun.argv.slice(2))` のみ |
| `tools/markov/command.ts` | 宣言から解析・usage・ヘルプ・終了コードを作る土台 |
| `tools/markov/commands.ts` | サブコマンドの表（並び順が `--help` の並び順） |
| `tools/markov/commands/<name>.ts` | コマンドごとの宣言（`defineCommand`）と処理 |
| `tools/markov/commands/options.ts` | 複数コマンドで共有するオプション宣言（`-i/--in-place`, `-d/--delimiter`） |
| `tools/markov/shared.ts` | モデル入出力と表示の寄り道 |