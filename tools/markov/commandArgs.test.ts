import { describe, expect, it } from "bun:test";

import {
  COMMAND_USAGE,
  commandUsageLine,
  expandInPlaceArgs,
  isMarkovCommand,
  MARKOV_COMMANDS,
  parseMarkovCommandArgs,
} from "./commandArgs";

/**
 * Parse `argv` for one command and narrow the union to that command's fields.
 * The guards are unreachable: `parseMarkovCommandArgs` echoes its command.
 */
const parseCorpus = (argv: string[]) => {
  const parsed = parseMarkovCommandArgs("corpus", argv);
  if (parsed.command !== "corpus") throw new Error(parsed.command);
  return parsed;
};
const parseUnlearn = (argv: string[]) => {
  const parsed = parseMarkovCommandArgs("unlearn", argv);
  if (parsed.command !== "unlearn") throw new Error(parsed.command);
  return parsed;
};
const parseDecrementPhrase = (argv: string[]) => {
  const parsed = parseMarkovCommandArgs("decrement-phrase", argv);
  if (parsed.command !== "decrement-phrase") throw new Error(parsed.command);
  return parsed;
};
const parseTokens = (argv: string[]) => {
  const parsed = parseMarkovCommandArgs("tokens", argv);
  if (parsed.command !== "tokens") throw new Error(parsed.command);
  return parsed;
};
const parseSearch = (argv: string[]) => {
  const parsed = parseMarkovCommandArgs("search", argv);
  if (parsed.command !== "search") throw new Error(parsed.command);
  return parsed;
};
const parseTransitions = (argv: string[]) => {
  const parsed = parseMarkovCommandArgs("transitions", argv);
  if (parsed.command !== "transitions") throw new Error(parsed.command);
  return parsed;
};

describe("expandInPlaceArgs", () => {
  it("expands -iSUFFIX into -i --suffix SUFFIX", () => {
    expect(expandInPlaceArgs(["decrement-phrase", "-i.bak", "m", "p"])).toEqual(
      ["decrement-phrase", "-i", "--suffix", ".bak", "m", "p"],
    );
  });

  it("leaves -i and --long alone", () => {
    expect(expandInPlaceArgs(["-i", "--in-place", "--index", "x"])).toEqual([
      "-i",
      "--in-place",
      "--index",
      "x",
    ]);
  });

  it("does not expand other short options with a value", () => {
    expect(expandInPlaceArgs(["-d/", "--delta", "2"])).toEqual([
      "-d/",
      "--delta",
      "2",
    ]);
  });
});

describe("isMarkovCommand", () => {
  it("accepts every known command", () => {
    for (const command of MARKOV_COMMANDS) {
      expect(isMarkovCommand(command)).toBe(true);
    }
  });

  it("rejects unknown commands", () => {
    expect(isMarkovCommand("corpusx")).toBe(false);
    expect(isMarkovCommand("")).toBe(false);
  });
});

describe("COMMAND_USAGE", () => {
  it("documents every command", () => {
    for (const command of MARKOV_COMMANDS) {
      expect(commandUsageLine(command)).toStartWith(
        `  bun run tools/markov/cli.ts ${COMMAND_USAGE[command]}`,
      );
    }
  });
});

describe("parseMarkovCommandArgs per-command options", () => {
  it("corpus accepts --tail", () => {
    expect(parseCorpus(["m.json", "--tail", "3"])).toEqual({
      command: "corpus",
      help: false,
      positionals: ["m.json"],
      tail: "3",
    });
  });

  it("corpus leaves tail undefined when omitted", () => {
    expect(parseCorpus(["m.json"]).tail).toBeUndefined();
  });

  it("tokens defaults sort to asToWeight", () => {
    expect(parseTokens(["m.json"]).sort).toBe("asToWeight");
  });

  it("search has no options beyond help", () => {
    expect(parseSearch(["m.json", "word"])).toEqual({
      command: "search",
      help: false,
      positionals: ["m.json", "word"],
    });
  });

  it("transitions defaults the delimiter to a space", () => {
    expect(parseTransitions(["m.json", "word"]).delimiter).toBe(" ");
  });

  it("decrement-phrase keeps delta distinguishable from the default", () => {
    const parsed = parseDecrementPhrase(["m.json", "a"]);
    expect(parsed.delta).toBeUndefined();
    expect(parsed.purge).toBe(false);
    expect(parsed.inPlace).toBe(false);
    expect(parsed.suffix).toBe("");
    expect(parsed.delimiter).toBe(" ");
  });

  it("decrement-phrase reports an explicit --delta", () => {
    expect(parseDecrementPhrase(["m.json", "a", "--delta=4"]).delta).toBe("4");
  });

  it("unlearn expands -iSUFFIX into inPlace/suffix", () => {
    const parsed = parseUnlearn(["m.json", "1", "-i.bak"]);
    expect(parsed.inPlace).toBe(true);
    expect(parsed.suffix).toBe(".bak");
  });
});

describe("parseMarkovCommandArgs rejects options of other commands", () => {
  const cases: { command: (typeof MARKOV_COMMANDS)[number]; args: string[] }[] =
    [
      { command: "transitions", args: ["m.json", "word", "--tail", "3"] },
      { command: "transitions", args: ["m.json", "word", "--sort", "token"] },
      { command: "tokens", args: ["m.json", "--tail", "3"] },
      { command: "tokens", args: ["m.json", "-i"] },
      { command: "corpus", args: ["m.json", "--sort", "token"] },
      { command: "corpus", args: ["m.json", "-i"] },
      { command: "search", args: ["m.json", "q", "-d", "/"] },
      { command: "unlearn", args: ["m.json", "1", "--purge"] },
    ];

  for (const { command, args } of cases) {
    it(`${command} rejects ${args.slice(2).join(" ")}`, () => {
      expect(() => parseMarkovCommandArgs(command, args)).toThrow();
    });
  }

  it("throws when an option value is missing", () => {
    expect(() =>
      parseMarkovCommandArgs("corpus", ["m.json", "--tail"]),
    ).toThrow();
  });
});

describe("parseMarkovCommandArgs help", () => {
  it("recognises -h and --help for every command", () => {
    for (const command of MARKOV_COMMANDS) {
      expect(parseMarkovCommandArgs(command, ["-h"]).help).toBe(true);
      expect(parseMarkovCommandArgs(command, ["--help"]).help).toBe(true);
      expect(parseMarkovCommandArgs(command, []).help).toBe(false);
    }
  });
});
