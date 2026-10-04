/**
 * `tools/markov/cli.ts` のサブコマンドごとのオプション定義。
 *
 * 以前は全コマンドで 1 つのオプション集合を `parseArgs` に渡していたため、
 * 別コマンドのオプション（`transitions --tail 3` など）が黙って無視されていた。
 * ここでは `COMMAND_OPTIONS` に宣言したオプションだけを `strict: true` で解析するので、
 * 知らないオプションはエラーになり、`cli.ts` がそのコマンドの usage を添えて終了する。
 */
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";

export const MARKOV_COMMANDS = [
  "corpus",
  "unlearn",
  "decrement-phrase",
  "tokens",
  "search",
  "transitions",
] as const;

export type MarkovCommand = (typeof MARKOV_COMMANDS)[number];

export const isMarkovCommand = (value: string): value is MarkovCommand =>
  (MARKOV_COMMANDS as readonly string[]).includes(value);

/** `--help` は全コマンドで共通。 */
const HELP_OPTION = {
  help: { type: "boolean", short: "h", default: false },
} as const;

/** `-i` / `-iSUFFIX`: 結果をファイルへ書き戻す（`-i.bak` は `suffix: ".bak"`）。 */
const IN_PLACE_OPTIONS = {
  "in-place": { type: "boolean", short: "i", default: false },
  suffix: { type: "string", default: "" },
} as const;

/** `-d DELIM`: フレーズを分割する区切り（既定は空白）。 */
const DELIMITER_OPTION = {
  delimiter: { type: "string", short: "d", default: " " },
} as const;

/** サブコマンドごとに受け付けるオプション。`cli.ts` の `switch` と 1:1 に対応する。 */
export const COMMAND_OPTIONS = {
  corpus: { tail: { type: "string" }, ...HELP_OPTION },
  unlearn: { ...IN_PLACE_OPTIONS, ...HELP_OPTION },
  "decrement-phrase": {
    // 既定値を置かない。`--purge` との併用可否を「明示されたか」で判定するため。
    delta: { type: "string" },
    purge: { type: "boolean", default: false },
    ...IN_PLACE_OPTIONS,
    ...DELIMITER_OPTION,
    ...HELP_OPTION,
  },
  tokens: { sort: { type: "string", default: "asToWeight" }, ...HELP_OPTION },
  search: { ...HELP_OPTION },
  transitions: { ...DELIMITER_OPTION, ...HELP_OPTION },
} as const satisfies Record<MarkovCommand, ParseArgsOptionsConfig>;

/** サブコマンドごとの usage 行。`bun run tools/markov/cli.ts` を前に足した完全な 1 行を返す。 */
export const COMMAND_USAGE = {
  corpus: "corpus <modelPath> [--tail N]",
  unlearn: "unlearn <modelPath> <n> [-i|-iSUFFIX]",
  "decrement-phrase":
    "decrement-phrase <modelPath> <phrase> [--delta N | --purge] [-i|-iSUFFIX] [-d DELIM]",
  tokens: "tokens <modelPath> [--sort token|asFrom|asToWeight]",
  search: "search <modelPath> <query>",
  transitions: "transitions <modelPath> <word> [-d DELIM]",
} as const satisfies Record<MarkovCommand, string>;

export const commandUsageLine = (command: MarkovCommand): string =>
  `  bun run tools/markov/cli.ts ${COMMAND_USAGE[command]}`;

/**
 * `-iSUFFIX` を `-i --suffix SUFFIX` に展開する。
 * 以降は長い形式だけ扱えばよいので、解析前に一度だけ変換する。
 */
export const expandInPlaceArgs = (argv: readonly string[]): string[] => {
  const expanded: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("-i") && arg.length > 2 && !arg.startsWith("--")) {
      expanded.push("-i", "--suffix", arg.slice(2));
    } else {
      expanded.push(arg);
    }
  }
  return expanded;
};

/** 全コマンドに共通する解析結果。 */
type ParsedCommandBase = {
  help: boolean;
  positionals: string[];
};

/**
 * コマンドごとの解析結果。`command` で判別できるので、`cli.ts` の
 * `switch (args.command)` ではそのコマンドのフィールドだけが型に出る。
 */
export type MarkovCommandArgs = ParsedCommandBase &
  (
    | { command: "corpus"; tail: string | undefined }
    | { command: "unlearn"; inPlace: boolean; suffix: string }
    | {
        command: "decrement-phrase";
        /** `--delta` が明示されたときだけ値を持つ。 */
        delta: string | undefined;
        purge: boolean;
        inPlace: boolean;
        suffix: string;
        delimiter: string;
      }
    | { command: "tokens"; sort: string }
    | { command: "search" }
    | { command: "transitions"; delimiter: string }
  );

/** 未知のオプションで失敗させる解析。値だけ引数として残す。 */
const parseStrict = <Options extends ParseArgsOptionsConfig>(
  argv: readonly string[],
  options: Options,
) => parseArgs({ args: argv, options, strict: true, allowPositionals: true });

/**
 * `argv`（コマンド名を除いた引数）を `command` のオプションだけで解析する。
 * 未知のオプションや値の欠落は `parseArgs` の例外として伝播する。
 */
export const parseMarkovCommandArgs = (
  command: MarkovCommand,
  argv: readonly string[],
): MarkovCommandArgs => {
  const args = expandInPlaceArgs(argv);

  switch (command) {
    case "corpus": {
      const { values, positionals } = parseStrict(args, COMMAND_OPTIONS.corpus);
      return { command, help: values.help, positionals, tail: values.tail };
    }
    case "unlearn": {
      const { values, positionals } = parseStrict(
        args,
        COMMAND_OPTIONS.unlearn,
      );
      return {
        command,
        help: values.help,
        positionals,
        inPlace: values["in-place"],
        suffix: values.suffix,
      };
    }
    case "decrement-phrase": {
      const { values, positionals } = parseStrict(
        args,
        COMMAND_OPTIONS["decrement-phrase"],
      );
      return {
        command,
        help: values.help,
        positionals,
        delta: values.delta,
        purge: values.purge,
        inPlace: values["in-place"],
        suffix: values.suffix,
        delimiter: values.delimiter,
      };
    }
    case "tokens": {
      const { values, positionals } = parseStrict(args, COMMAND_OPTIONS.tokens);
      return { command, help: values.help, positionals, sort: values.sort };
    }
    case "search": {
      const { values, positionals } = parseStrict(args, COMMAND_OPTIONS.search);
      return { command, help: values.help, positionals };
    }
    case "transitions": {
      const { values, positionals } = parseStrict(
        args,
        COMMAND_OPTIONS.transitions,
      );
      return {
        command,
        help: values.help,
        positionals,
        delimiter: values.delimiter,
      };
    }
  }
};
