/**
 * Per-command argument parsing for `tools/markov/cli.ts`.
 *
 * Each subcommand declares only the options it actually understands, so
 * passing e.g. `--tail` to `transitions` fails loudly instead of being
 * silently ignored.
 */
import { parseArgs } from "node:util";

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

export const COMMAND_USAGE = {
  corpus: "corpus <modelPath> [--tail N]",
  unlearn: "unlearn <modelPath> <n> [-i|-iSUFFIX]",
  "decrement-phrase":
    "decrement-phrase <modelPath> <phrase> [--delta N | --purge] [-i|-iSUFFIX] [-d DELIM]",
  tokens: "tokens <modelPath> [--sort token|asFrom|asToWeight]",
  search: "search <modelPath> <query>",
  transitions: "transitions <modelPath> <word> [-d DELIM]",
} as const satisfies Record<MarkovCommand, string>;

/** Usage line shown per command, including the `bun run` invocation prefix. */
export const commandUsageLine = (command: MarkovCommand): string =>
  `  bun run tools/markov/cli.ts ${COMMAND_USAGE[command]}`;

/**
 * Expand the `-iSUFFIX` shorthand into `-i --suffix SUFFIX` so every command
 * only ever sees the long form.
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

type ParsedCommandBase = {
  help: boolean;
  positionals: string[];
};

export type MarkovCommandArgs = ParsedCommandBase &
  (
    | { command: "corpus"; tail: string | undefined }
    | { command: "unlearn"; inPlace: boolean; suffix: string }
    | {
        command: "decrement-phrase";
        /** `undefined` unless `--delta` was passed explicitly. */
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

const HELP_OPTION = {
  help: { type: "boolean", short: "h", default: false },
} as const;

const IN_PLACE_OPTIONS = {
  "in-place": { type: "boolean", short: "i", default: false },
  suffix: { type: "string", default: "" },
} as const;

const DELIMITER_OPTION = {
  delimiter: { type: "string", short: "d", default: " " },
} as const;

/**
 * Parse `argv` (already stripped of the command name) for `command`.
 * Throws the underlying `parseArgs` error on unknown options or a missing
 * option value.
 */
export const parseMarkovCommandArgs = (
  command: MarkovCommand,
  argv: readonly string[],
): MarkovCommandArgs => {
  const args = expandInPlaceArgs(argv);

  switch (command) {
    case "corpus": {
      const { values, positionals } = parseArgs({
        args,
        options: { tail: { type: "string" }, ...HELP_OPTION },
        strict: true,
        allowPositionals: true,
      });
      return {
        command,
        help: values.help,
        positionals,
        tail: values.tail,
      };
    }
    case "unlearn": {
      const { values, positionals } = parseArgs({
        args,
        options: { ...IN_PLACE_OPTIONS, ...HELP_OPTION },
        strict: true,
        allowPositionals: true,
      });
      return {
        command,
        help: values.help,
        positionals,
        inPlace: values["in-place"],
        suffix: values.suffix,
      };
    }
    case "decrement-phrase": {
      const { values, positionals } = parseArgs({
        args,
        options: {
          delta: { type: "string" },
          purge: { type: "boolean", default: false },
          ...IN_PLACE_OPTIONS,
          ...DELIMITER_OPTION,
          ...HELP_OPTION,
        },
        strict: true,
        allowPositionals: true,
      });
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
      const { values, positionals } = parseArgs({
        args,
        options: {
          sort: { type: "string", default: "asToWeight" },
          ...HELP_OPTION,
        },
        strict: true,
        allowPositionals: true,
      });
      return {
        command,
        help: values.help,
        positionals,
        sort: values.sort,
      };
    }
    case "search": {
      const { values, positionals } = parseArgs({
        args,
        options: { ...HELP_OPTION },
        strict: true,
        allowPositionals: true,
      });
      return { command, help: values.help, positionals };
    }
    case "transitions": {
      const { values, positionals } = parseArgs({
        args,
        options: { ...DELIMITER_OPTION, ...HELP_OPTION },
        strict: true,
        allowPositionals: true,
      });
      return {
        command,
        help: values.help,
        positionals,
        delimiter: values.delimiter,
      };
    }
  }
};
