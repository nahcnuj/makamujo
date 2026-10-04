/**
 * サブコマンドの「宣言」から、解析・usage・ヘルプ・終了まで。
 *
 * お手本は **git**。git も 1 コマンド 1 ファイル（`builtin/<cmd>.c`）で、その
 * コマンドが受理するオプションだけを `struct option[]` に書いて
 * `parse_options()` に渡している。`parse_options()` は表に無い名前を受け付けず、
 * `git <command> --help` にはその表から作った usage だけが出る。
 * ここでは同じことを宣言で表す。
 *
 * | git | このファイル |
 * |---|---|
 * | `builtin/<cmd>.c` の `struct option[]` | `options`（コマンドごとの宣言） |
 * | usage 文字列に書く `<modelPath>` | `args`（宣言順が位置引数の順） |
 * | `parse_options()` | `parseArgs`（`strict: true`） |
 * | `usage_with_options()` | `usage` と `help`（宣言から作る） |
 * | `run_argv()`（コマンドを選んでパサへ渡す） | `dispatch` |
 *
 * 契約は `architecture/markov-cli.md`。
 */
import { parseArgs } from "node:util";

/** usage の先頭に付ける呼び出し方。 */
export const INVOCATION = "bun run markov";

/** 全コマンド共通のヘルプ指定。宣言には書かない。 */
const HELP_FLAGS = ["-h", "--help"] as const;

/** 引数が間違っているとき。`dispatch` が usage を添えて終了する。 */
export class UsageError extends Error {}

/** 例外を人が読む 1 行にする。 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 位置引数 1 個の宣言。 */
export type ArgumentDeclaration = {
  /** ヘルプに出す説明。 */
  readonly help: string;
  /** 1 以上の整数であることを検証する。検証後も文字列のまま `run` に渡す。 */
  readonly integer?: true;
};

/** 位置引数の宣言（名前 → 宣言）。usage では `<名前>` と出る。 */
export type ArgumentDeclarations = Readonly<
  Record<string, ArgumentDeclaration>
>;

/** オプション 1 個の宣言。`parseArgs` の指定に説明と検証を加えたもの。 */
export type OptionDeclaration = {
  /** `"string"` なら次の引数を値に取る。`"boolean"` なら値を持たないフラグ。 */
  readonly type: "string" | "boolean";
  /** 短縮形（`-i` の `i`）。あれば usage・ヘルプは短縮形を先に書く。 */
  readonly short?: string;
  /** 既定値。string で省略すると `undefined` になるので「未指定」と区別できる。 */
  readonly default?: string | boolean;
  /** 許される値。宣言すると検証し、ヘルプには `a|b|c` と書く。 */
  readonly choices?: readonly string[];
  /** 1 以上の整数であることを検証する。検証後も文字列のまま `run` に渡す。 */
  readonly integer?: true;
  /** ヘルプに出す説明。 */
  readonly help: string;
};

/** オプションの宣言（名前 → 宣言）。ここに無いものは弾かれる。 */
export type OptionDeclarations = Readonly<Record<string, OptionDeclaration>>;

/** `parseArgs` に渡す設定。`strict: true` なので宣言に無いオプションはエラー。 */
type ParseConfig<Declared extends OptionDeclarations> = {
  args: string[];
  options: Declared;
  strict: true;
  allowPositionals: true;
};

/** `run` が受け取る引数。位置引数もオプションも宣言どおりの名前で入る。 */
export type CommandArgs<
  Arguments extends ArgumentDeclarations,
  Declared extends OptionDeclarations,
> = ReturnType<typeof parseArgs<ParseConfig<Declared>>>["values"] & {
  readonly [Name in keyof Arguments]: string;
};

/** 宣言そのもの（型を消した形）。usage・ヘルプの生成に使う。 */
export type CommandDeclaration = {
  readonly name: string;
  /** `--help` に並べる 1 行の説明。 */
  readonly summary: string;
  readonly args: ArgumentDeclarations;
  readonly options: OptionDeclarations;
};

/** サブコマンドの表に並べる形。宣言ごとに違う型を同じ型にそろえる。 */
export type Command = CommandDeclaration & {
  /** 使い方の部分（`corpus <modelPath> [--tail]`）。`INVOCATION` は含まない。 */
  readonly usage: string;
  /** このコマンドだけのヘルプ。 */
  readonly help: string;
  /** `--help` なら `helpRequested`、でなければ解析して `run` して `executed`。 */
  readonly invoke: (argv: readonly string[]) => "executed" | "helpRequested";
};

/** `defineCommand` の戻り値。`parse` と `run` は宣言の型付きなのでテストからも呼べる。 */
export type DefinedCommand<
  Arguments extends ArgumentDeclarations,
  Declared extends OptionDeclarations,
> = Command & {
  readonly parse: (argv: readonly string[]) => CommandArgs<Arguments, Declared>;
  readonly run: (args: CommandArgs<Arguments, Declared>) => void;
};

/** 説明の列を揃えた 2 列の表。 */
const table = (
  cells: readonly (readonly [left: string, right: string])[],
): string => {
  const width = Math.max(...cells.map(([left]) => left.length));
  return cells
    .map(([left, right]) => `  ${left.padEnd(width)}  ${right}`.trimEnd())
    .join("\n");
};

/** オプションが値を取るときに書く名前。`choices` は `a|b|c`、なければ大文字の名前。 */
const valueNameOf = (name: string, option: OptionDeclaration): string =>
  option.choices?.join("|") ?? name.toUpperCase();

/** 1 個のオプションがヘルプの Options でどう見えるか（`-d, --delimiter DELIM`）。 */
const labelOf = (name: string, option: OptionDeclaration): string => {
  const short = option.short ? `-${option.short}, ` : "  ";
  const value =
    option.type === "boolean" ? "" : ` ${valueNameOf(name, option)}`;
  return `${short}--${name}${value}`;
};

/** `corpus <modelPath> [--tail]` のような、使い方だけの部分。 */
const usageOf = (declaration: CommandDeclaration): string =>
  [
    declaration.name,
    ...Object.keys(declaration.args).map((name) => `<${name}>`),
    ...Object.entries(declaration.options).map(([name, option]) =>
      option.short === undefined ? `[--${name}]` : `[-${option.short}]`,
    ),
  ].join(" ");

/** このコマンドだけのヘルプ（使い方・位置引数・オプション）。 */
const helpOf = (declaration: CommandDeclaration, usage: string): string => {
  const sections = [
    `Usage:\n  ${INVOCATION} ${usage}\n  ${declaration.summary}`,
  ];
  const args = Object.entries(declaration.args);
  if (args.length > 0) {
    sections.push(
      `Arguments:\n${table(
        args.map(([name, { help }]) => [`<${name}>`, help]),
      )}`,
    );
  }
  sections.push(
    `Options:\n${table([
      ...Object.entries(declaration.options).map(
        ([name, option]) => [labelOf(name, option), option.help] as const,
      ),
      [HELP_FLAGS.join(", "), "show this help"],
    ])}`,
  );
  return sections.join("\n\n");
};

/** 全コマンドのヘルプ。表の並び順がそのまま出る。 */
export const helpText = (commands: readonly Command[]): string =>
  [
    `Usage:\n  ${INVOCATION} <command> [options]\n  ${INVOCATION} <command> --help`,
    `Commands:\n${table(
      commands.map((command) => [command.usage, command.summary] as const),
    )}`,
  ].join("\n\n");

/** `-h` / `--help` かどうか。 */
const isHelpFlag = (arg: string): boolean =>
  HELP_FLAGS.some((flag) => flag === arg);

/** `-h` / `--help` を取り除き、指定されていたかを返す。全コマンド共通の指定。 */
const takeHelpFlags = (
  argv: readonly string[],
): { help: boolean; args: string[] } => ({
  help: argv.some(isHelpFlag),
  args: argv.filter((arg) => !isHelpFlag(arg)),
});

/** 宣言した検証（`integer` と `choices`）を通す。 */
const assertDeclaredValue = (
  label: string,
  declaration: { integer?: true; choices?: readonly string[] },
  value: string | boolean | undefined,
): void => {
  if (typeof value !== "string") return;
  if (declaration.integer !== undefined && !/^[1-9][0-9]*$/.test(value)) {
    throw new UsageError(`${label} must be a positive integer, got ${value}`);
  }
  const { choices } = declaration;
  if (choices && !choices.some((choice) => choice === value)) {
    throw new UsageError(
      `${label} must be one of ${choices.join(", ")} (got ${value})`,
    );
  }
};

/** 宣言どおりの引数だけを解析する。未知のオプション・位置引数の過不足は UsageError。 */
export const parseCommandArgs = <
  const Arguments extends ArgumentDeclarations,
  const Declared extends OptionDeclarations,
>(
  declaration: {
    readonly args: Arguments;
    readonly options: Declared;
  },
  argv: readonly string[],
): CommandArgs<Arguments, Declared> => {
  let parsed: ReturnType<typeof parseArgs<ParseConfig<Declared>>>;
  try {
    parsed = parseArgs<ParseConfig<Declared>>({
      args: [...argv],
      options: declaration.options,
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    throw new UsageError(errorMessage(error));
  }
  const values: Readonly<Record<string, string | boolean | undefined>> =
    parsed.values;
  for (const [name, option] of Object.entries(declaration.options)) {
    assertDeclaredValue(`--${name}`, option, values[name]);
  }

  const names = Object.keys(declaration.args);
  const named: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    const { integer } = declaration.args[name] ?? {};
    const value = parsed.positionals[index];
    if (value === undefined) {
      throw new UsageError(`missing argument <${name}>`);
    }
    assertDeclaredValue(name, { integer }, value);
    named[name] = value;
  }
  const extra = parsed.positionals[names.length];
  if (extra !== undefined) {
    throw new UsageError(`unexpected argument ${JSON.stringify(extra)}`);
  }
  // キーは宣言からしか分からないので、ここだけが宣言の型に合わせて締める。
  return Object.assign({}, parsed.values, named) as CommandArgs<
    Arguments,
    Declared
  >;
};

/**
 * サブコマンドを宣言する。
 *
 * `args` は「名前 → 宣言」の表で、usage と `run` の引数名はここから来る。
 * `options` は `parseArgs` の指定そのものなので、宣言に無いオプションは弾かれる。
 */
export const defineCommand = <
  const Arguments extends ArgumentDeclarations,
  const Declared extends OptionDeclarations,
>(spec: {
  readonly name: string;
  readonly summary: string;
  readonly args: Arguments;
  readonly options: Declared;
  readonly run: (args: CommandArgs<Arguments, Declared>) => void;
}): DefinedCommand<Arguments, Declared> => {
  const usage = usageOf(spec);
  return {
    ...spec,
    usage,
    help: helpOf(spec, usage),
    parse: (argv) => parseCommandArgs(spec, argv),
    run: spec.run,
    invoke: (argv) => {
      const { help, args } = takeHelpFlags(argv);
      if (help) {
        return "helpRequested";
      }
      spec.run(parseCommandArgs(spec, args));
      return "executed";
    },
  };
};

/** サブコマンドを選んで `run` まで進める。終了とエラー表示はすべてここで行う。 */
export const dispatch = (
  commands: readonly Command[],
  argv: readonly string[],
): void => {
  // サブコマンドは「`-` で始まらない最初の引数」。残りはそのコマンドの分だけ。
  const commandIndex = argv.findIndex((arg) => !arg.startsWith("-"));
  const name = commandIndex === -1 ? undefined : argv[commandIndex];
  const args = argv.filter((_, index) => index !== commandIndex);

  if (name === undefined) {
    console.error(helpText(commands));
    process.exit(argv.some(isHelpFlag) ? 0 : 1);
  }

  const command = commands.find((candidate) => candidate.name === name);
  if (!command) {
    console.error(`unknown command: ${name}\n\n${helpText(commands)}`);
    process.exit(1);
  }

  let helpRequested = false;

  try {
    if (command.invoke(args) === "helpRequested") {
      helpRequested = true;
    }
  } catch (error) {
    const usage =
      error instanceof UsageError
        ? `\n\nUsage:\n  ${INVOCATION} ${command.usage}`
        : "";
    console.error(`error: ${errorMessage(error)}${usage}`);
    process.exit(1);
  }
  if (helpRequested) {
    console.error(command.help);
    process.exit(0);
  }
};
