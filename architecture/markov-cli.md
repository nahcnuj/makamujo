# markov CLI の設計

`bun run markov <command> [options]` のサブコマンド CLI。実装は `tools/markov/`。

## お手本: git（サブコマンドごとのオプション表）

**git** をお手本にする。git の各サブコマンドは、**そのコマンドが受理する
オプションだけを宣言した表**を `parse_options()` に渡している（`builtin/<cmd>.c`）。

```c
/* builtin/log.c */
static const char builtin_log_usage[] =
N_("git log [<options>] [<revision-range>] [[--] <path>...]");

static struct option log_options[] = {
	OPT_BOOL(0, "reverse", &reverse, N_("show commits in reverse order")),
	OPT_END(),
};

/* cmd_log() の中。渡すのは表と usage、そして flags だけ。 */
argc = parse_options(argc, argv, prefix, log_options, builtin_log_usage, flags);
```

`parse_options()`（`parse-options.c`）はその表に無い名前を受け付けず、
`<command> --help` にはその表から作った usage だけが出る。
この CLI も**同じ契約**にする。

issue #534（`transitions --tail 3` が黙って無視される、`search --sort` が別の
意味になる）が起きていたのは、全コマンドで 1 つのオプション表を共有していたため。
なので**正は各コマンドの `options` 宣言**、その他はそこから作る。

借りるのは「オプション表をコマンドごとに持つ」という**構造**で、git の
実装（C の getopt）そのものではない。形だけを並べると:

```c
/* git: builtin/<cmd>.c */
static struct option <cmd>_options[] = { OPT_BOOL(...), ..., OPT_END() };
argc = parse_options(argc, argv, prefix, <cmd>_options, <cmd>_usage, flags);
```

```ts
/* この CLI: tools/markov/commands/<name>.ts */
export const <cmd>Command = defineCommand({
  name: "<name>",
  summary: "…",
  positionals: { modelPath: "…" },
  options: {
    /* ここが git の struct option[] */
  },
  run: (args) => {
    /* ここが git の cmd_<name>() */
  },
});
```

## オプション表

**正は各コマンドの `options` 宣言**。下の表は `bun run markov --help` に出る内容で、
`tools/markov/commands.test.ts` の `TABLE` が同じ文字列を固定している（表を
読み違えたらテストが落ちる）。

| コマンド | 位置引数 | オプション | 宣言 |
|---|---|---|---|
| `corpus` | `modelPath` | `--tail N` | `commands/corpus.ts` |
| `unlearn` | `modelPath`, `n` | `-i/--in-place`, `--suffix`※ | `commands/unlearn.ts` |
| `decrement-phrase` | `modelPath`, `phrase` | `--delta N`, `--purge`, `-i/--in-place`, `--suffix`※, `-d/--delimiter` | `commands/decrementPhrase.ts` |
| `tokens` | `modelPath` | `--sort token\|asFrom\|asToWeight` | `commands/tokens.ts` |
| `search` | `modelPath`, `query` | （`--help` のみ） | `commands/search.ts` |
| `transitions` | `modelPath`, `word` | `-d/--delimiter` | `commands/transitions.ts` |

※ `--suffix` は `-i.bak` の受け皿で内部用（`description` が無い）。受理されるが
usage・ヘルプには出ない。git の `OPT__HIDDEN` と同じ意味。

## git との対応

| git | この CLI |
|---|---|
| `builtin/<cmd>.c` の `struct option[] options[]` | `commands/<name>.ts` の `options`（`defineCommand` に書く表） |
| usage 文字列 | `positionals` と `options` から作る `usage` |
| `parse_options()` | `parseCommandArgs`（Node の `parseArgs` を `strict: true` で使う） |
| `usage_with_options()` | `helpOf` / `helpText` |
| `run_argv()`（コマンドを選んでパサへ渡す） | `dispatch` |
| `OPT__HIDDEN`（説明も usage にも出ない内部用オプション） | `description` を書かないオプション（`--suffix` がこれ） |
| `-i<suffix>` のような独自表記 | `-i.bak` を `-i --suffix .bak` に展開（`hasInlineSuffix`） |

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
| `tools/markov/commands.ts` | サブコマンドの並び順（`--help` の並び順）だけを持つ |
| `tools/markov/commands/<name>.ts` | コマンドごとの宣言（`defineCommand`）と処理 |
| `tools/markov/commands/options.ts` | 複数コマンドで共有するオプション宣言（`-i/--in-place`, `-d/--delimiter`） |
| `tools/markov/shared.ts` | モデル入出力と表示の寄り道 |
| `tools/markov/command.test.ts` | 土台（解析・usage・ヘルプ・終了コード）の単体テスト |
| `tools/markov/commands.test.ts` | オプション表（上の表）を固定する単体テスト |
| `tools/markov/cli.test.ts` | 実プロセスの統合テスト（別コマンドのオプションを弾く等） |

## コマンドを足すとき

1. `commands/<name>.ts` に `defineCommand({ name, summary, positionals, options, run })`
   を書く。usage・ヘルプ・未知のオプションの検出は宣言から自動で効く。
2. `commands.ts` の `markovCommands` に並べる（並び順が `--help` の並び順）。
3. `commands.test.ts` の `TABLE` に usage を足す。

`-i/--in-place` や `-d/--delimiter` のような共通オプションは
`commands/options.ts` から使う。コマンドごとに書き直さない。

## 表の確認方法

```console
$ bun run markov --help                      # 全コマンドの表
$ bun run markov decrement-phrase --help     # そのコマンドだけの usage・引数・オプション
$ bun run markov transitions m.json word --tail 3
error: Unknown option '--tail'. …
Usage:
  bun run tools/markov/cli.ts transitions <modelPath> <word> [-d DELIM]
```
