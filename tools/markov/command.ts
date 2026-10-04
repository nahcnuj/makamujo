/**
 * サブコマンドの「宣言」から解析・usage・ヘルプ・終了まで。
 *
 * お手本は git の `builtin/parse-options.c`。git もコマンドごとに
 * `struct option[]` を置き、宣言に無いオプションはそのコマンドを解析するときに
 * 弾き、`<command> --help` にはそのコマンドの usage だけを出す。
 * ここでは同じことを宣言で表す。
 *
 * - `options` … git の `struct option[]`（ここが「どのコマンドが何を認めるか」の正）
 * - `positionals` … git の usage 文字列に書く `<modelPath>`
 * - `usage` / `help` … 宣言から作る（git の `usage_with_options()` に相当）
 * - `dispatch` … git の `run_argv()`（コマンドを選んでパサへ渡す）
 *
 * 宣言表は `commands/<name>.ts`、表の並び順は `commands.ts`。
 * 設計は `architecture/markov-cli.md`。
 */
import { parseArgs } from "node:util";

/** 呼び出し方。usage 行の先頭に付く。 */
export const INVOCATION = "bun run tools/markov/cli.ts";

/** 全コマンド共通のヘルプ指定。宣言ごとに書かなくてよい。 */
const HELP_FLAGS = ["-h", "--help"] as const;

/** 引数が間違っているとき。`dispatch` が usage を添えて終了する。 */
export class UsageError extends Error {}

/** 処理の失敗（モデルを読めない等）。usage は添えない。 */
export class CliError extends Error {}

/** 例外を人が読む 1 行にする。 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 位置引数の宣言（名前 → 説明）。usage では `<名前>` と出る。 */
export type PositionalDeclarations = Readonly<Record<string, string>>;

/** オプション 1 個の宣言。`parseArgs` の指定に usage 用の情報と説明を足す。 */
export type OptionDeclaration = {
  /** `"string"` なら次の引数を値に取る。`"boolean"` なら値を持たないフラグ。 */
  readonly type: "string" | "boolean";
  /** 短縮形（`-i` の `i`）。あれば usage・ヘルプは短縮形を先に書く。 */
  readonly short?: string;
  /** 既定値。string で省略すると `undefined` になるので「未指定」と区別できる。 */
  readonly default?: string | boolean;
  /** usage に書く値の名前（`--tail N` の `N`）。省略時は大文字の名前。 */
  readonly value?: string;
  /** 許される値。宣言すると検証し、usage には `a|b|c` と書く。 */
  readonly choices?: readonly string[];
  /**
   * ヘルプに出す説明。書かないオプションは内部用で、usage にもヘルプにも出ない
   * （git の `OPT__HIDDEN` と同じ意味。`--suffix` がこれ）。
   */
  readonly description?: string;
};

/** オプションの宣言（名前 → 宣言）。ここに無いものは弾かれる。 */
export type OptionDeclarations = Readonly<Record<string, OptionDeclaration>>;

/** `parseArgs` に渡す設定。`strict: true` なので宣言に無いオプションはエラー。 */
type ParseConfig<Options extends OptionDeclarations> = {
  args: string[];
  options: Options;
  strict: true;
  allowPositionals: true;
};

/** `run` が受け取る引数。位置引数もオプションも宣言どおりの名前で入る。 */
export type CommandArgs<
  Positionals extends PositionalDeclarations,
  Options extends OptionDeclarations,
> = ReturnType<typeof parseArgs<ParseConfig<Options>>>["values"] & {
  readonly [Name in keyof Positionals]: string;
};

/** 宣言そのもの（型を消した形）。usage・ヘルプの生成に使う。 */
export type CommandDeclaration = {
  readonly name: string;
  /** `--help` に並べる 1 行の説明。 */
  readonly summary: string;
  readonly positionals: PositionalDeclarations;
  readonly options: OptionDeclarations;
};

/** サブコマンドの表に並べる形。宣言ごとに違う型を同じ型にそろえる。 */
export type Command = CommandDeclaration & {
  /** 使い方の部分（`corpus <modelPath> [--tail N]`）。`INVOCATION` は含まない。 */
  readonly usage: string;
  /** このコマンドだけのヘルプ。 */
  readonly help: string;
  /** `--help` なら `helpRequested`、でなければ解析して `run` して `executed`。 */
  readonly invoke: (argv: readonly string[]) => "executed" | "helpRequested";
};

/** `defineCommand` の戻り値。`parse` と `run` は宣言の型付きなのでテストからも呼べる。 */
export type DefinedCommand<
  Positionals extends PositionalDeclarations,
  Options extends OptionDeclarations,
> = Command & {
  readonly parse: (
    argv: readonly string[],
  ) => CommandArgs<Positionals, Options>;
  readonly run: (args: CommandArgs<Positionals, Options>) => void;
};

/** 説明の列を揃えた 2 列の表。 */
const table = (rows: readonly { left: string; right: string }[]): string => {
  const width = Math.max(...rows.map((row) => row.left.length));
  return rows
    .map((row) => `  ${row.left.padEnd(width)}  ${row.right}`.trimEnd())
    .join("\n");
};

/** usage に書く値の名前。`choices` があれば `a|b|c`、なければ `value`、なければ大文字の名前。 */
const valueNameOf = (name: string, option: OptionDeclaration): string =>
  option.choices?.join("|") ?? option.value ?? name.toUpperCase();

/**
 * `-i.bak` を許すか。`--in-place` と `--suffix` の組だけ。
 * 展開（`expandInPlace`）と usage の `[-i|-iSUFFIX]` の両方がこれを見る。
 */
const hasInlineSuffix = (options: OptionDeclarations): boolean =>
  options["in-place"]?.short === "i" && options.suffix?.type === "string";

/** usage のオプション部分（`[--tail N]` / `[--purge]`）。説明が無い内部用は出さない。 */
const usageOptionsOf = (options: OptionDeclarations): string[] => {
  const inlineSuffix = hasInlineSuffix(options);
  return Object.entries(options).flatMap(([name, option]) => {
    if (option.description === undefined) {
      return [];
    }
    const flag = option.short ? `-${option.short}` : `--${name}`;
    if (option.type !== "boolean") {
      return [`[${flag} ${valueNameOf(name, option)}]`];
    }
    return [
      inlineSuffix && name === "in-place"
        ? `[${flag}|${flag}SUFFIX]`
        : `[${flag}]`,
    ];
  });
};

/** 1 個のオプションがヘルプの Options でどう見えるか（`-d, --delimiter DELIM`）。 */
const labelOf = (name: string, option: OptionDeclaration): string => {
  const short = option.short ? `-${option.short}, ` : "";
  const value =
    option.type === "boolean" ? "" : ` ${valueNameOf(name, option)}`;
  return `${short}--${name}${value}`;
};

/** `corpus <modelPath> [--tail N]` のような、使い方だけの部分。 */
const usageOf = (declaration: CommandDeclaration): string => {
  const positionals = Object.keys(declaration.positionals).map(
    (name) => `<${name}>`,
  );
  return [
    declaration.name,
    ...positionals,
    ...usageOptionsOf(declaration.options),
  ].join(" ");
};

/** このコマンドだけのヘルプ（使い方・位置引数・オプション）。 */
const helpOf = (declaration: CommandDeclaration, usage: string): string => {
  const sections = [
    `Usage:\n  ${INVOCATION} ${usage}\n  ${declaration.summary}`,
  ];
  const positionals = Object.entries(declaration.positionals);
  if (positionals.length > 0) {
    sections.push(
      `Arguments:\n${table(
        positionals.map(([name, description]) => ({
          left: `<${name}>`,
          right: description,
        })),
      )}`,
    );
  }
  const options = Object.entries(declaration.options).flatMap(
    ([name, option]) =>
      option.description === undefined
        ? []
        : [{ left: labelOf(name, option), right: option.description }],
  );
  sections.push(
    `Options:\n${table([
      ...options,
      { left: HELP_FLAGS.join(", "), right: "show this help" },
    ])}`,
  );
  return sections.join("\n\n");
};

/** 全コマンドのヘルプ。表の並び順がそのまま出る。 */
export const helpText = (commands: readonly Command[]): string =>
  [
    `Usage:\n  ${INVOCATION} <command> [options]\n  ${INVOCATION} <command> --help`,
    `Commands:\n${table(
      commands.map((command) => ({
        left: command.usage,
        right: command.summary,
      })),
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

/**
 * `-i.bak` を `-i --suffix .bak` に展開する。
 * `-d/` のように短縮形の直後に値を書くのは `parseArgs` がそのまま扱う。
 */
const expandInPlace = (
  options: OptionDeclarations,
  argv: readonly string[],
): string[] =>
  hasInlineSuffix(options)
    ? argv.flatMap((arg) =>
        /^-i.+/.test(arg) ? ["-i", "--suffix", arg.slice(2)] : [arg],
      )
    : [...argv];

/** `choices` を宣言したオプションの値を確認する。 */
const assertChoices = (
  options: OptionDeclarations,
  values: Readonly<Record<string, unknown>>,
): void => {
  for (const [name, value] of Object.entries(values)) {
    const choices = options[name]?.choices;
    if (choices && !choices.some((choice) => choice === value)) {
      throw new UsageError(
        `--${name} must be one of ${choices.join(", ")} (got ${String(value)})`,
      );
    }
  }
};

/** 宣言どおりのオプションだけを解析する。未知のオプション・位置引数の過不足は UsageError。 */
export const parseCommandArgs = <
  const Positionals extends PositionalDeclarations,
  const Options extends OptionDeclarations,
>(
  declaration: {
    readonly positionals: Positionals;
    readonly options: Options;
  },
  argv: readonly string[],
): CommandArgs<Positionals, Options> => {
  let parsed: ReturnType<typeof parseArgs<ParseConfig<Options>>>;
  try {
    parsed = parseArgs<ParseConfig<Options>>({
      args: expandInPlace(declaration.options, argv),
      options: declaration.options,
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    throw new UsageError(errorMessage(error));
  }
  assertChoices(declaration.options, parsed.values);

  const names = Object.keys(declaration.positionals);
  const named: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    const value = parsed.positionals[index];
    if (value === undefined) {
      throw new UsageError(`missing argument <${name}>`);
    }
    named[name] = value;
  }
  const extra = parsed.positionals[names.length];
  if (extra !== undefined) {
    throw new UsageError(`unexpected argument ${JSON.stringify(extra)}`);
  }
  // キーは宣言からしか分からないので、ここだけが宣言の型に合わせて締める。
  return Object.assign({}, parsed.values, named) as CommandArgs<
    Positionals,
    Options
  >;
};

/**
 * サブコマンドを宣言する。
 *
 * `positionals` は「名前 → 説明」の表で、usage と `run` の引数名はここから来る。
 * `options` は `parseArgs` の指定そのものなので、宣言に無いオプションは弾かれる。
 */
export const defineCommand = <
  const Positionals extends PositionalDeclarations,
  const Options extends OptionDeclarations,
>(spec: {
  readonly name: string;
  readonly summary: string;
  readonly positionals: Positionals;
  readonly options: Options;
  readonly run: (args: CommandArgs<Positionals, Options>) => void;
}): DefinedCommand<Positionals, Options> => {
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
    const help = argv.some(isHelpFlag);
    console.error(helpText(commands));
    process.exit(help ? 0 : 1);
  }

  const command = commands.find((candidate) => candidate.name === name);
  if (!command) {
    console.error(`unknown command: ${name}\n\n${helpText(commands)}`);
    process.exit(1);
  }

  try {
    if (command.invoke(args) === "helpRequested") {
      console.error(command.help);
      process.exit(0);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(
        `error: ${error.message}\n\nUsage:\n  ${INVOCATION} ${command.usage}`,
      );
      process.exit(1);
    }
    if (error instanceof CliError) {
      console.error(`error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
};
