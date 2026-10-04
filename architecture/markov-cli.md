# markov CLI の設計

`bun run markov <command> [options]` のサブコマンド CLI。実装は `tools/markov/`。

## お手本: git

**git** をお手本にする。git の各サブコマンドは、**そのコマンドが受理するオプションだけを
宣言した表**を `parse_options()` に渡している（1 コマンド 1 ファイルの `builtin/<cmd>.c`）。

```c
/* builtin/log.c */
static const char builtin_log_usage[] =
N_("git log [<options>] [<revision-range>] [[--] <path>...]");

static struct option log_options[] = {
	OPT_BOOL(0, "reverse", &reverse, N_("show commits in reverse order")),
	OPT_END(),
};

/* cmd_log() の中 */
argc = parse_options(argc, argv, prefix, log_options, builtin_log_usage, flags);
```

`parse_options()` は表に無い名前を受け付けず、`git <command> --help` にはその表から作った
usage だけが出る。git は全コマンドで 1 つのオプション表を共有していない。

この CLI も同じ形にする。借りるのは「**1 コマンド 1 ファイル、そのコマンドのオプション表
だけを解析する**」という構造で、git の実装（C の getopt）そのものではない。

| git | この CLI |
|---|---|
| `builtin/<cmd>.c` の `struct option[]` | `tools/markov/commands/<name>.ts` の `options` |
| usage 文字列に書く `<modelPath>` | `args`（宣言順が位置引数の順） |
| `parse_options()` | `parseArgs`（`strict: true`） |
| `usage_with_options()` | `usage` と `help`（宣言から作る） |
| `run_argv()`（コマンドを選んでパサへ渡す） | `dispatch` |

## 表は宣言そのもの

**表はドキュメントに書かず、宣言が表である。** `bun run markov --help` の出力は
`commands/<name>.ts` の `args` と `options` から作られるので、宣言を直せば `--help` も
直る。下の実出力が、その全表。

```console
$ bun run markov --help
Usage:
  bun run markov <command> [options]
  bun run markov <command> --help

Commands:
  corpus <modelPath> [--tail]                              list corpus entries (1 = newest)
  unlearn <modelPath> <n> [-i] [--suffix]                  drop the n-th corpus entry from the end (1 = newest)
  decrement-phrase <modelPath> <phrase> [--delta] [--purge] [-i] [--suffix] [-d]
                                                           weaken (or purge) the transitions of a phrase
  tokens <modelPath> [--sort]                              per-token statistics as CSV
  search <modelPath> <query>                               tokens containing the query, as CSV
  transitions <modelPath> <word> [-d]                      transitions around a word as CSV
```

コマンドごとの表は `bun run markov <command> --help` に出る。`search` はオプションを
宣言していないので、受理するのは `--help` だけになる。

```console
$ bun run markov decrement-phrase --help
Usage:
  bun run markov decrement-phrase <modelPath> <phrase> [--delta] [--purge] [-i] [--suffix] [-d]
  weaken (or purge) the transitions of a phrase

Arguments:
  <modelPath>  path of the model file
  <phrase>     phrase whose transitions are weakened

Options:
    --delta DELTA            subtract N from the weights (default 1); not with --purge
    --purge                  drop the transitions instead of weakening them
  -i, --in-place             write the model back to <modelPath> (default: print to stdout)
    --suffix SUFFIX          copy <modelPath> to <modelPath>SUFFIX before --in-place
  -d, --delimiter DELIMITER  delimiter inside the phrase
  -h, --help                 show this help

$ bun run markov search --help
Usage:
  bun run markov search <modelPath> <query>
  tokens containing the query, as CSV

Arguments:
  <modelPath>  path of the model file
  <query>      substring to look for

Options:
  -h, --help  show this help
```

上の文字列は `tools/markov/commands.test.ts` の `TABLE` が固定している（表を読み違えたら
テストが落ちる）。

## 宣言の意味

宣言は 2 つだけ。どちらも「名前 → 宣言」の表で、順序がそのまま usage の順序になる。

| 宣言 | 項目 | 意味 |
|---|---|---|
| `args` | `help` | 位置引数の説明。`run` には文字列で届く |
| `args` | `integer` | 1 以上の整数であることを検証する |
| `options` | `type` | `"string"` なら値を取る。`"boolean"` ならフラグ |
| `options` | `short` | 短縮形。`-i` の `i` |
| `options` | `default` | 既定値。省くと `undefined` なので「未指定」と区別できる |
| `options` | `choices` | 許される値。検証し、ヘルプには `a\|b\|c` と出る |
| `options` | `integer` | 1 以上の整数であることを検証する |
| `options` | `help` | ヘルプに出す説明 |

受理する名前はこの表に無いと弾かれる。宣言に無いオプションを「内部用」「隠す」ために
書く方法はない（書けば表に出る）。

## 契約

- 受理するオプションは、そのコマンドの `options` 宣言だけ。`parseArgs` の `strict: true`
  がそれ以外をエラーにし、`dispatch` がそのコマンドの usage 1 行を添えて終了コード 1 に
  する（他のコマンドのオプションは黙って無視しない）。
- `--help` は全コマンド共通の指定。`markov --help` が全表、`markov <command> --help` が
  そのコマンドだけの usage・引数・オプションを出す。どちらも終了コード 0。
- 引数が間違っているとき（`UsageError`）だけ usage を添える。それ以外のエラーは
  `error: <message>` の 1 行で、usage は添えない。どちらも終了コード 1。
- `--delta` は既定値を宣言しないので「未指定」と `1` を区別できる。`--purge` との排他は
  `run` が `UsageError` にする（引数の組み合わせは表では表せないため）。
- 値の検証は宣言に書く（`choices` / `integer`）。コマンド側が同じ検査を書かない。

## ファイル

| ファイル | 役割 |
|---|---|
| `tools/markov/cli.ts` | 入口。`dispatch(markovCommands, Bun.argv.slice(2))` の 1 行 |
| `tools/markov/commands.ts` | サブコマンドの並び順（`--help` の並び順）だけを持つ |
| `tools/markov/commands/<name>.ts` | 1 コマンド 1 ファイル。オプション表（`options`）と処理（`run`） |
| `tools/markov/command.ts` | 宣言から解析・usage・ヘルプ・終了コードを作る土台 |
| `tools/markov/modelFile.ts` | モデルファイルの読み込み（`readModelJson`）と書き戻し（`emitModel`） |
| `tools/markov/output.ts` | 人が読む出力（`visibleNGram`, `printCsv`） |
| `tools/markov/command.test.ts` | 土台（解析・usage・ヘルプ・終了コード）の単体テスト |
| `tools/markov/commands.test.ts` | オプション表（上の表）と宣言の検証の単体テスト |
| `tools/markov/modelFile.test.ts` / `tools/markov/output.test.ts` | `modelFile` / `output` の単体テスト |
| `tools/markov/cli.test.ts` | 実プロセスの統合テスト（別コマンドのオプションを弾く等） |

モデルと CLI の間の処理は、1 つのコマンドでしか使わないものならそのコマンドファイルに
置き、複数コマンドで使うものだけを上の 2 ファイルに置く。オプション宣言を共有する
ファイルは作らない（git も同じで、`struct option[]` はコマンドのファイルにある）。

## コマンドを足すとき

1. `commands/<name>.ts` に `defineCommand({ name, summary, args, options, run })` を書く。
   usage・ヘルプ・未知のオプションの検出は宣言から自動で効く。
2. `commands.ts` の `markovCommands` に並べる（並び順が `--help` の並び順）。
3. `commands.test.ts` の `TABLE` に usage を足す。

## 表の確認方法

```console
$ bun run markov --help                      # 全コマンドの表
$ bun run markov decrement-phrase --help     # そのコマンドだけの表
$ bun run markov transitions m.json word --tail 3
error: Unknown option '--tail'. …
Usage:
  bun run markov transitions <modelPath> <word> [-d]
```