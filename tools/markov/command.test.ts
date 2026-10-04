import { describe, expect, it, spyOn } from "bun:test";

import {
  CliError,
  type Command,
  defineCommand,
  dispatch,
  helpText,
  INVOCATION,
  parseCommandArgs,
  UsageError,
} from "./command";

/**
 * 宣言の機能をひととおり使うテスト用のコマンド。
 * 位置引数・既定値・choices・`-iSUFFIX`・内部用オプション（説明の無い `suffix`）を
 * すべて含めている。
 */
const fixture = defineCommand({
  name: "fixture",
  summary: "fixture command",
  positionals: {
    modelPath: "path of the model file",
    n: "1-based index",
  },
  options: {
    tail: { type: "string", value: "N", description: "newest N entries" },
    sort: {
      type: "string",
      default: "asToWeight",
      choices: ["token", "asToWeight"],
      description: "column to sort by",
    },
    "in-place": {
      type: "boolean",
      short: "i",
      default: false,
      description: "write the model back",
    },
    suffix: { type: "string", default: "" },
    delimiter: {
      type: "string",
      short: "d",
      default: " ",
      value: "DELIM",
      description: "delimiter inside the phrase",
    },
  },
  run: () => {},
});

/** 2 列の表の 1 行。列の揃え方の桁数を固定せずに意味だけ確かめる。 */
const row = (left: string, right: string): RegExp => {
  const literal = (text: string): string =>
    text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^ {2}${literal(left)} {2,}${literal(right)}$`, "m");
};

describe("parseCommandArgs", () => {
  it("names positionals as declared and applies declared defaults", () => {
    expect(fixture.parse(["m.json", "2"])).toEqual({
      modelPath: "m.json",
      n: "2",
      tail: undefined,
      sort: "asToWeight",
      "in-place": false,
      suffix: "",
      delimiter: " ",
    });
  });

  it("reads short and long option names", () => {
    const args = fixture.parse([
      "m.json",
      "2",
      "--tail",
      "3",
      "-d",
      "/",
      "-i",
      "--sort=token",
    ]);
    expect(args.tail).toBe("3");
    expect(args.delimiter).toBe("/");
    expect(args["in-place"]).toBe(true);
    expect(args.sort).toBe("token");
  });

  it("keeps an option without a default distinguishable from the default", () => {
    expect(fixture.parse(["m.json", "1"]).tail).toBeUndefined();
  });

  it("rejects an option the command does not declare", () => {
    expect(() => fixture.parse(["m.json", "1", "--delta", "2"])).toThrow(
      UsageError,
    );
    expect(() => fixture.parse(["m.json", "1", "--delta", "2"])).toThrow(
      "--delta",
    );
  });

  it("rejects a missing option value", () => {
    expect(() => fixture.parse(["m.json", "1", "--tail"])).toThrow(UsageError);
  });

  it("rejects a missing positional by name", () => {
    expect(() => fixture.parse(["m.json"])).toThrow("missing argument <n>");
  });

  it("rejects an unexpected extra positional", () => {
    expect(() => fixture.parse(["m.json", "1", "extra"])).toThrow(
      'unexpected argument "extra"',
    );
  });

  it("rejects a value outside the declared choices", () => {
    expect(() => fixture.parse(["m.json", "1", "--sort", "nope"])).toThrow(
      "--sort must be one of token, asToWeight (got nope)",
    );
  });

  it("expands -iSUFFIX into -i --suffix SUFFIX", () => {
    const args = fixture.parse(["m.json", "1", "-i.bak"]);
    expect(args["in-place"]).toBe(true);
    expect(args.suffix).toBe(".bak");
  });

  it("leaves -i and the value attached to a short option alone", () => {
    const args = fixture.parse(["m.json", "1", "-i", "-d/"]);
    expect(args["in-place"]).toBe(true);
    expect(args.suffix).toBe("");
    expect(args.delimiter).toBe("/");
  });

  it("leaves an unknown --help-like option to parseArgs", () => {
    expect(() => fixture.parse(["m.json", "1", "--helpful"])).toThrow(
      UsageError,
    );
  });

  it("is also usable on its own for a declaration", () => {
    const args = parseCommandArgs({ positionals: {}, options: {} }, []);
    expect(Object.keys(args)).toEqual([]);
  });
});

describe("invoke", () => {
  it("runs the command and reports that it ran", () => {
    const calls: string[] = [];
    const command = defineCommand({
      name: "counter",
      summary: "count",
      positionals: {},
      options: {},
      run: () => {
        calls.push("ran");
      },
    });
    expect(command.invoke([])).toBe("executed");
    expect(calls).toEqual(["ran"]);
  });

  it("stops at -h / --help without running", () => {
    const calls: string[] = [];
    const command = defineCommand({
      name: "counter",
      summary: "count",
      positionals: {},
      options: {},
      run: () => {
        calls.push("ran");
      },
    });
    expect(command.invoke(["-h"])).toBe("helpRequested");
    expect(command.invoke(["--help"])).toBe("helpRequested");
    expect(command.invoke(["m.json", "--help"])).toBe("helpRequested");
    expect(calls).toEqual([]);
  });

  it("reports an unknown option as a usage error", () => {
    expect(() => fixture.invoke(["m.json", "1", "--nope"])).toThrow(UsageError);
  });
});

describe("usage", () => {
  it("lists positionals and options in declaration order", () => {
    expect(fixture.usage).toBe(
      "fixture <modelPath> <n> [--tail N] [--sort token|asToWeight] [-i|-iSUFFIX] [-d DELIM]",
    );
  });

  it("leaves an internal option (no description) out of the usage", () => {
    expect(fixture.usage).not.toContain("--suffix");
    expect(fixture.usage).not.toContain("SUFFIX ");
  });

  it("shows plain boolean options without a suffix", () => {
    const command = defineCommand({
      name: "flags",
      summary: "…",
      positionals: {},
      options: {
        purge: { type: "boolean", description: "purge it" },
        quiet: {
          type: "boolean",
          short: "q",
          description: "say nothing",
        },
      },
      run: () => {},
    });
    expect(command.usage).toBe("flags [--purge] [-q]");
  });

  it("prefixes the invocation when the usage is shown to a user", () => {
    expect(fixture.help.startsWith(`Usage:\n  ${INVOCATION} fixture `)).toBe(
      true,
    );
  });
});

describe("help", () => {
  it("shows the summary, arguments, options and their descriptions", () => {
    const help = fixture.help;
    expect(help).toContain("  fixture command");
    expect(help).toContain("Arguments:");
    expect(help).toMatch(row("<modelPath>", "path of the model file"));
    expect(help).toMatch(row("<n>", "1-based index"));
    expect(help).toContain("Options:");
    expect(help).toMatch(row("--tail N", "newest N entries"));
    expect(help).toMatch(row("--sort token|asToWeight", "column to sort by"));
    expect(help).toMatch(row("-i, --in-place", "write the model back"));
    expect(help).toMatch(
      row("-d, --delimiter DELIM", "delimiter inside the phrase"),
    );
    expect(help).toMatch(row("-h, --help", "show this help"));
  });

  it("never mentions an internal option (no description)", () => {
    expect(fixture.help).not.toContain("--suffix");
  });
});

describe("helpText", () => {
  it("lists every command with its usage and summary", () => {
    const text = helpText([
      fixture,
      defineCommand({
        name: "other",
        summary: "other command",
        positionals: {},
        options: {},
        run: () => {},
      }),
    ]);
    expect(text.startsWith(`Usage:\n  ${INVOCATION} <command> [options]`)).toBe(
      true,
    );
    expect(text).toContain("Commands:");
    expect(text).toContain(fixture.usage);
    expect(text).toContain("fixture command");
    expect(text).toContain("other");
    expect(text).toContain("other command");
  });
});

describe("dispatch", () => {
  const fixtureCommand = defineCommand({
    name: "fixture",
    summary: "fixture command",
    positionals: { modelPath: "path of the model file" },
    options: {
      tail: { type: "string", value: "N", description: "newest N entries" },
    },
    run: () => {},
  });
  const commands: Command[] = [fixtureCommand];

  /** `dispatch` は終了コードを自分で決めるので、`process.exit` と出力を差し替える。 */
  const dispatchCapturing = (
    table: readonly Command[],
    argv: readonly string[],
  ): { code: number | undefined; printed: string[] } => {
    const printed: string[] = [];
    const errors = spyOn(console, "error").mockImplementation((message) => {
      printed.push(String(message));
    });
    const exit = spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    let code: number | undefined;
    try {
      dispatch(table, argv);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("exit ")) {
        throw error;
      }
      code = Number(error.message.slice("exit ".length));
    } finally {
      errors.mockRestore();
      exit.mockRestore();
    }
    return { code, printed };
  };

  it("prints the whole table and fails when no command is given", () => {
    expect(dispatchCapturing(commands, [])).toEqual({
      code: 1,
      printed: [helpText(commands)],
    });
  });

  it("prints the whole table and succeeds for --help", () => {
    expect(dispatchCapturing(commands, ["--help"])).toEqual({
      code: 0,
      printed: [helpText(commands)],
    });
  });

  it("prints that command's help and succeeds for a per-command --help", () => {
    expect(dispatchCapturing(commands, ["fixture", "--help"])).toEqual({
      code: 0,
      printed: [fixtureCommand.help],
    });
  });

  it("rejects an unknown command with the whole table", () => {
    const { code, printed } = dispatchCapturing(commands, ["nope"]);
    expect(code).toBe(1);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain("unknown command: nope");
    expect(printed[0]).toContain(helpText(commands));
  });

  it("reports an undeclared option with the usage of that command", () => {
    const { code, printed } = dispatchCapturing(commands, [
      "fixture",
      "m.json",
      "--purge",
    ]);
    expect(code).toBe(1);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain("error: Unknown option '--purge'.");
    expect(printed[0]).toContain(
      `\n\nUsage:\n  ${INVOCATION} fixture <modelPath> [--tail N]`,
    );
  });

  it("reports a runtime failure without a usage", () => {
    const failing = [
      defineCommand({
        name: "boom",
        summary: "fails",
        positionals: {},
        options: {},
        run: () => {
          throw new CliError("model is broken");
        },
      }),
    ];
    expect(dispatchCapturing(failing, ["boom"])).toEqual({
      code: 1,
      printed: ["error: model is broken"],
    });
  });

  it("rethrows an error that is not a CLI error", () => {
    const crashing = [
      defineCommand({
        name: "crash",
        summary: "crashes",
        positionals: {},
        options: {},
        run: () => {
          throw new RangeError("bug");
        },
      }),
    ];
    expect(() => dispatch(crashing, ["crash"])).toThrow(RangeError);
  });
});

describe("Command", () => {
  it("exposes the declaration next to the generated help", () => {
    const command: Command = fixture;
    expect(Object.keys(command.positionals)).toEqual(["modelPath", "n"]);
    expect(Object.keys(command.options)).toEqual([
      "tail",
      "sort",
      "in-place",
      "suffix",
      "delimiter",
    ]);
  });
});
