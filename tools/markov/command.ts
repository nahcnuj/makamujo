/**
 * サブコマンド 1 個の「宣言」から解析・usage・ヘルプ・終了までを作る土台。
 *
 * 宣言（`name` / `summary` / `positionals` / `options` / `run`）だけから
 * - `parseArgs` に渡すオプション集合
 * - usage 行（エラー表示と `--help` に使う）
 * - `run` が受け取る引数（位置引数もオプションも宣言どおりの名前と型）
 * を作っている。`commands.ts` には宣言しか書かなくてよい。
 *
 * 宣言に無いオプションは `parseArgs` の `strict: true` がエラーにするので、
 * 別コマンドのオプション（`transitions --tail 3` など）は黙って無視されない。
 */
import { parseArgs } from "node:util";

/** 呼び出し方。usage 行の先頭に付く。 */
export const INVOCATION = "bun run tools/markov/cli.ts";

/** 全コマンド共通のヘルプ指定。宣言ごとに書かなくてよい。 */
const HELP_FLAGS = ["-h", "--help"] as const;

/** ヘルプの Options に出す形。 */
const HELP_FLAG_USAGE = HELP_FLAGS.join(", ");

/** `-h` / `--help` かどうか。 */
export const isHelpFlag = (arg: string): boolean =>
  HELP_FLAGS.some((flag) => flag === arg);

/** 位置引数の宣言。キーが名前（usage では `<modelPath>` と出る）、値が表示用の説明。 */
export type PositionalDeclarations = Readonly<Record<string, string>>;

/** オプションの宣言。`parseArgs` の指定に説明と usage 用の情報を足したもの。 */
export type CommandOption = {
  /** `"string"` なら次の引数を値に取る。`"boolean"` なら値を持たないフラグ。 */
  readonly type: "string" | "boolean";
  /** 短縮形（`-i` の `i`）。あれば usage には短縮形だけを出す。 */
  readonly short?: string;
  /** 既定値。string オプションを省略すると `undefined` なので「未指定」を区別できる。 */
  readonly default?: string | boolean;
  /** usage に書く値の名前（`--tail N` の `N`）。 */
  readonly value?: string;
  /** 許される値。宣言すると検証し、usage には `a|b|c` と書く。 */
  readonly choices?: readonly string[];
  /** `-i.bak` のように短縮形の直後に値を書くと、この名前のオプションへ渡す（`"suffix"` など）。 */
  readonly inlineSuffix?: string;
  /** usage にもヘルプにも出さない。`inlineSuffix` の受け皿など内部で使う。 */
  readonly hidden?: boolean;
  /** ヘルプに出す説明。 */
  readonly description: string;
};

export type OptionDeclarations = Readonly<Record<string, CommandOption>>;

type ParseConfig<Options extends OptionDeclarations> = {
  args: string[];
  options: Options;
  strict: true;
  allowPositionals: true;
};

/** `parseArgs` が返す `values` の型。既定値も宣言どおりに効く。 */
type OptionValues<Options extends OptionDeclarations> = ReturnType<
  typeof parseArgs<ParseConfig<Options>>
>["values"];

/** `run` が受け取る引数。位置引数もオプションも宣言どおりの名前で入る。 */
export type CommandArgs<
  Positionals extends PositionalDeclarations,
  Options extends OptionDeclarations,
> = OptionValues<Options> & { readonly [Name in keyof Positionals]: string };

/** 引数が間違っているとき。`dispatch` が usage を添えて終了する。 */
export class UsageError extends Error {}

/** 処理の失敗（モデルを読めない等）。usage は添えない。 */
export class CliError extends Error {}

/** `invoke` の結果。`--help` なら `dispatch` がヘルプを出す。 */
export type InvokeResult = "executed" | "helpRequested";

/** サブコマンドの表に並べる形。宣言の型は消してあり、コマンドごとに違っても同じ型。 */
export type Command = {
  readonly name: string;
  /** `--help` に並べる 1 行の説明。 */
  readonly summary: string;
  /** 使い方の部分（`corpus <modelPath> [--tail N]`）。`INVOCATION` は含まない。 */
  readonly usage: string;
  /** 宣言した位置引数（名前 → 説明）。 */
  readonly positionals: PositionalDeclarations;
  /** 宣言したオプション（名前 → 宣言）。ここに無いものは弾かれる。 */
  readonly options: OptionDeclarations;
  /** このコマンドだけのヘルプ。 */
  readonly help: string;
  /** 宣言どおりのオプションだけを解析して `run` まで進める。誤りは投げる。 */
  readonly invoke: (argv: readonly string[]) => InvokeResult;
};

/** `defineCommand` の戻り値。`parse` / `run` をテストからも呼べるようにしておく。 */
export type DefinedCommand<
  Positionals extends PositionalDeclarations,
  Options extends OptionDeclarations,
> = Command & {
  readonly parse: (
    argv: readonly string[],
  ) => CommandArgs<Positionals, Options>;
  readonly run: (args: CommandArgs<Positionals, Options>) => void;
};

/** 例外を人が読む 1 行にする。 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 使い方に付ける、呼び出し方込みの 1 行。 */
export const usageLineOf = (usage: string): string => `${INVOCATION} ${usage}`;

/** コマンドの表を並べる。 */
const usageLine = (command: Command): string => usageLineOf(command.usage);

type Declaration<
  Positionals extends PositionalDeclarations,
  Options extends OptionDeclarations,
> = {
  readonly name: string;
  readonly summary: string;
  readonly positionals: Positionals;
  readonly options: Options;
};

/** usage に書く値の名前。`choices` があれば `a|b|c`、なければ `value`、なければ大文字の名前。 */
const optionValueName = (name: string, option: CommandOption): string =>
  option.choices?.join("|") ?? option.value ?? name.toUpperCase();

/** オプション 1 個が usage でどう見えるか。`hidden` なら出さない。 */
const optionUsage = (
  name: string,
  option: CommandOption,
): string | undefined => {
  if (option.hidden) {
    return undefined;
  }
  if (option.type === "boolean") {
    if (option.inlineSuffix && option.short) {
      return `[-${option.short}|-${option.short}SUFFIX]`;
    }
    return `[${option.short ? `-${option.short}` : `--${name}`}]`;
  }
  const flag = option.short ? `-${option.short}` : `--${name}`;
  return `[${flag} ${optionValueName(name, option)}]`;
};

/** ヘルプの Options に出す 1 行（`-i, -iSUFFIX` / `--tail N`）。 */
const optionHelpLine = (name: string, option: CommandOption): string => {
  if (option.type === "boolean") {
    if (option.inlineSuffix && option.short) {
      return `-${option.short}, -${option.short}SUFFIX`;
    }
    return option.short ? `-${option.short}, --${name}` : `--${name}`;
  }
  const value = optionValueName(name, option);
  return option.short
    ? `-${option.short}, --${name} ${value}`
    : `--${name} ${value}`;
};

/** `corpus <modelPath> [--tail N]` のような、使い方だけの部分。 */
const usageOf = <
  Positionals extends PositionalDeclarations,
  Options extends OptionDeclarations,
>(
  declaration: Declaration<Positionals, Options>,
): string => {
  const positionals = Object.keys(declaration.positionals).map(
    (name) => `<${name}>`,
  );
  const options = Object.entries(declaration.options).flatMap(
    ([name, option]) => {
      const usage = optionUsage(name, option);
      return usage ? [usage] : [];
    },
  );
  return [declaration.name, ...positionals, ...options].join(" ");
};

/** 2 列の表（説明の列を揃える）。 */
const columns = (
  rows: readonly { left: string; right: string }[],
): string[] => {
  const width = Math.max(...rows.map((row) => row.left.length));
  return rows.map((row) =>
    `  ${row.left.padEnd(width)}  ${row.right}`.trimEnd(),
  );
};

/** このコマンドだけのヘルプ（使い方・位置引数・オプション）。 */
const helpOf = <
  Positionals extends PositionalDeclarations,
  Options extends OptionDeclarations,
>(
  declaration: Declaration<Positionals, Options>,
  usage: string,
): string => {
  const blocks = [
    `Usage:\n  ${usageLineOf(usage)}`,
    `  ${declaration.summary}`,
  ];
  const positionals = Object.entries(declaration.positionals);
  if (positionals.length > 0) {
    blocks.push(
      `Arguments:\n${columns(
        positionals.map(([name, description]) => ({
          left: `<${name}>`,
          right: description,
        })),
      ).join("\n")}`,
    );
  }
  const options = Object.entries(declaration.options).filter(
    ([, option]) => !option.hidden,
  );
  blocks.push(
    `Options:\n${columns([
      ...options.map(([name, option]) => ({
        left: optionHelpLine(name, option),
        right: option.description,
      })),
      { left: HELP_FLAG_USAGE, right: "show this help" },
    ]).join("\n")}`,
  );
  return blocks.join("\n\n");
};

/** 全コマンドのヘルプ。表の並び順がそのまま出る。 */
export const helpText = (commands: readonly Command[]): string => {
  const header = `Usage:\n  ${INVOCATION} <command> [options]\n  ${INVOCATION} <command> --help`;
  const table = columns(
    commands.map((command) => ({
      left: command.usage,
      right: command.summary,
    })),
  ).join("\n");
  return `${header}\n\nCommands:\n${table}`;
};

/** `-h` / `--help` を取り除き、指定されていたかを返す。全コマンド共通の指定。 */
const takeHelpFlag = (
  argv: readonly string[],
): { help: boolean; args: string[] } => {
  const args: string[] = [];
  let help = false;
  for (const arg of argv) {
    if (isHelpFlag(arg)) {
      help = true;
      continue;
    }
    args.push(arg);
  }
  return { help, args };
};

/** `-i.bak` を `-i --suffix .bak` に展開する（`inlineSuffix` を宣言したオプションだけ）。 */
const expandInlineSuffix = (
  options: OptionDeclarations,
  argv: readonly string[],
): string[] => {
  const shorts = Object.values(options).flatMap((option) =>
    option.type === "boolean" && option.short && option.inlineSuffix
      ? [{ short: option.short, suffixOption: option.inlineSuffix }]
      : [],
  );
  const expanded: string[] = [];
  for (const arg of argv) {
    const pair = shorts.find(
      ({ short }) =>
        arg.startsWith(`-${short}`) && arg.length > short.length + 1,
    );
    expanded.push(
      ...(pair
        ? [
            `-${pair.short}`,
            `--${pair.suffixOption}`,
            arg.slice(pair.short.length + 1),
          ]
        : [arg]),
    );
  }
  return expanded;
};

/** `choices` を宣言したオプションの値を確認する。 */
const assertChoices = <Options extends OptionDeclarations>(
  options: Options,
  values: OptionValues<Options>,
): void => {
  for (const [name, value] of Object.entries(values)) {
    const option = options[name];
    if (option?.choices && !option.choices.some((choice) => choice === value)) {
      throw new UsageError(
        `--${name} must be one of ${option.choices.join(", ")} (got ${String(value)})`,
      );
    }
  }
};

/**
 * 宣言どおりの名前と型で値を並べる。
 * キーは宣言からしか分からないので、ここだけが宣言の型に合わせて締める。
 */
const withPositionals = <
  Positionals extends PositionalDeclarations,
  Options extends OptionDeclarations,
>(
  values: OptionValues<Options>,
  named: Record<string, string>,
): CommandArgs<Positionals, Options> =>
  Object.assign({}, values, named) as CommandArgs<Positionals, Options>;

/** 宣言どおりのオプションだけを解析する。未知のオプション・値の欠落は UsageError。 */
export const parseCommandArgs = <
  Positionals extends PositionalDeclarations,
  Options extends OptionDeclarations,
>(
  declaration: Declaration<Positionals, Options>,
  argv: readonly string[],
): CommandArgs<Positionals, Options> => {
  const args = expandInlineSuffix(declaration.options, argv);
  let parsed: ReturnType<typeof parseArgs<ParseConfig<Options>>>;
  try {
    parsed = parseArgs<ParseConfig<Options>>({
      args,
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
  return withPositionals<Positionals, Options>(parsed.values, named);
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
>(
  spec: Declaration<Positionals, Options> & {
    readonly run: (args: CommandArgs<Positionals, Options>) => void;
  },
): DefinedCommand<Positionals, Options> => {
  const usage = usageOf(spec);
  return {
    name: spec.name,
    summary: spec.summary,
    usage,
    help: helpOf(spec, usage),
    positionals: spec.positionals,
    options: spec.options,
    parse: (argv) => parseCommandArgs(spec, takeHelpFlag(argv).args),
    run: spec.run,
    invoke: (argv) => {
      const { help, args } = takeHelpFlag(argv);
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
        `error: ${error.message}\n\nUsage:\n  ${usageLine(command)}`,
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
