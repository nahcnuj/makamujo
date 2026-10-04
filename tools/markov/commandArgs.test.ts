import { describe, expect, it } from "bun:test";

import {
  COMMAND_OPTIONS,
  COMMAND_USAGE,
  commandUsageLine,
  expandInPlaceArgs,
  isMarkovCommand,
  MARKOV_COMMANDS,
  type MarkovCommand,
  parseMarkovCommandArgs,
} from "./commandArgs";

/** コマンドごとに受け付けるオプション。`-h` / `--help` は全コマンド共通なので除く。 */
const ACCEPTED_OPTIONS: Record<MarkovCommand, readonly string[]> = {
  corpus: ["--tail"],
  unlearn: ["-i", "--in-place", "--suffix"],
  "decrement-phrase": [
    "-i",
    "--in-place",
    "--suffix",
    "--delta",
    "--purge",
    "-d",
    "--delimiter",
  ],
  tokens: ["--sort"],
  search: [],
  transitions: ["-d", "--delimiter"],
};

/** 全コマンドのオプションを並べたもの。コマンドをまたぐ渡しは拒否されること。 */
const ALL_OPTIONS = [
  "-d",
  "-i",
  "--delta",
  "--delimiter",
  "--in-place",
  "--purge",
  "--sort",
  "--suffix",
  "--tail",
] as const;

/** 解析結果をコマンドの型に絞る。`parseMarkovCommandArgs` は渡された command を返す。 */
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
  it("documents every command with the invocation prefix", () => {
    for (const command of MARKOV_COMMANDS) {
      expect(commandUsageLine(command)).toBe(
        `  bun run tools/markov/cli.ts ${COMMAND_USAGE[command]}`,
      );
    }
  });
});

describe("COMMAND_OPTIONS", () => {
  it("declares an option set for every command", () => {
    expect(Object.keys(COMMAND_OPTIONS)).toEqual([...MARKOV_COMMANDS]);
  });

  it("accepts --help everywhere", () => {
    for (const command of MARKOV_COMMANDS) {
      expect(Object.keys(COMMAND_OPTIONS[command])).toContain("help");
    }
  });
});

describe("parseMarkovCommandArgs accepts only its own options", () => {
  for (const command of MARKOV_COMMANDS) {
    it(`${command} は自分のオプションだけを受け付ける`, () => {
      const accepted = [...ACCEPTED_OPTIONS[command], "-h", "--help"];

      for (const option of [...ALL_OPTIONS, "-h", "--help"] as const) {
        // boolean オプションの値は positionals に落ちるだけなので一律 3 引数で試す。
        const parse = () =>
          parseMarkovCommandArgs(command, ["m.json", option, "value"]);
        if (accepted.includes(option)) {
          expect(parse).not.toThrow();
        } else {
          expect(parse).toThrow();
        }
      }
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

describe("parseMarkovCommandArgs values", () => {
  it("corpus keeps tail undefined when omitted", () => {
    expect(parseCorpus(["m.json"]).tail).toBeUndefined();
  });

  it("corpus reads --tail", () => {
    expect(parseCorpus(["m.json", "--tail", "3"]).tail).toBe("3");
  });

  it("tokens defaults sort to asToWeight", () => {
    expect(parseTokens(["m.json"]).sort).toBe("asToWeight");
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

  it("transitions only reads the delimiter", () => {
    expect(parseMarkovCommandArgs("transitions", ["m.json", "word"])).toEqual({
      command: "transitions",
      help: false,
      positionals: ["m.json", "word"],
      delimiter: " ",
    });
  });

  it("unlearn expands -iSUFFIX into inPlace/suffix", () => {
    const parsed = parseUnlearn(["m.json", "1", "-i.bak"]);
    expect(parsed.inPlace).toBe(true);
    expect(parsed.suffix).toBe(".bak");
  });
});
