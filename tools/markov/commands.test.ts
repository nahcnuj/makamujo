import { describe, expect, it } from "bun:test";

import { UsageError } from "./command";
import {
  corpusCommand,
  decrementPhraseCommand,
  markovCommands,
  searchCommand,
  tokensCommand,
  transitionsCommand,
  unlearnCommand,
} from "./commands";

/** 表そのもの。`--help` と issue #534 のどちらもここを基準に見る。 */
const NAMES = [
  "corpus",
  "unlearn",
  "decrement-phrase",
  "tokens",
  "search",
  "transitions",
];

const USAGES = [
  "corpus <modelPath> [--tail N]",
  "unlearn <modelPath> <n> [-i|-iSUFFIX]",
  "decrement-phrase <modelPath> <phrase> [--delta N] [--purge] [-i|-iSUFFIX] [-d DELIM]",
  "tokens <modelPath> [--sort token|asFrom|asToWeight]",
  "search <modelPath> <query>",
  "transitions <modelPath> <word> [-d DELIM]",
];

describe("markovCommands", () => {
  it("holds every command exactly once, in help order", () => {
    expect(markovCommands.map((command) => command.name)).toEqual(NAMES);
    expect(markovCommands.map((command) => command.usage)).toEqual(USAGES);
  });

  it("gives every command a one-line summary", () => {
    for (const command of markovCommands) {
      expect(command.summary.length).toBeGreaterThan(0);
      expect(command.summary).not.toContain("\n");
    }
  });

  it("declares every positionals with a description", () => {
    for (const command of markovCommands) {
      for (const [name, description] of Object.entries(command.positionals)) {
        expect(description.length).toBeGreaterThan(0);
        expect(command.usage).toContain(`<${name}>`);
      }
    }
  });

  it("mentions every declared option in its usage, except hidden ones", () => {
    for (const command of markovCommands) {
      for (const [name, option] of Object.entries(command.options)) {
        if (option.hidden) {
          expect(command.usage).not.toContain(`--${name}`);
          continue;
        }
        // 短縮形があるオプションは usage では短縮形で出る。
        expect(command.usage).toContain(
          option.short === undefined ? `--${name}` : `-${option.short}`,
        );
      }
    }
  });

  it("takes no options that another command declares", () => {
    const everyOption = [
      ...new Set(
        markovCommands.flatMap((command) => Object.keys(command.options)),
      ),
    ];
    for (const command of markovCommands) {
      for (const name of everyOption) {
        if (name in command.options) {
          continue;
        }
        expect(() => command.invoke(["m.json", `word`, `--${name}`])).toThrow(
          UsageError,
        );
        expect(() => command.invoke(["m.json", `word`, `--${name}`])).toThrow(
          `--${name}`,
        );
      }
    }
  });

  it("keeps the shared write-back options on the two commands that write", () => {
    expect(Object.keys(unlearnCommand.options)).toEqual(["in-place", "suffix"]);
    expect(Object.keys(decrementPhraseCommand.options)).toEqual([
      "delta",
      "purge",
      "in-place",
      "suffix",
      "delimiter",
    ]);
  });
});

describe("argument checks that happen before the model is read", () => {
  it("rejects a --tail that is not a positive integer", () => {
    expect(() =>
      corpusCommand.run(corpusCommand.parse(["m.json", "--tail", "0"])),
    ).toThrow("--tail must be a positive integer");
  });

  it("rejects an unlearn index that is not a positive integer", () => {
    expect(() =>
      unlearnCommand.run(unlearnCommand.parse(["m.json", "x"])),
    ).toThrow("n must be a positive integer");
  });

  it("rejects --delta that is not a positive integer", () => {
    expect(() =>
      decrementPhraseCommand.run(
        decrementPhraseCommand.parse(["m.json", "phrase", "--delta", "abc"]),
      ),
    ).toThrow("--delta must be a positive integer");
  });

  it("rejects --purge together with --delta", () => {
    expect(() =>
      decrementPhraseCommand.run(
        decrementPhraseCommand.parse([
          "m.json",
          "phrase",
          "--purge",
          "--delta",
          "1",
        ]),
      ),
    ).toThrow("--purge and --delta cannot be used together");
  });

  it("rejects an empty phrase", () => {
    expect(() =>
      decrementPhraseCommand.run(
        decrementPhraseCommand.parse(["m.json", " ", "-d", " "]),
      ),
    ).toThrow("phrase is empty");
  });

  it("rejects a --sort outside the declared choices", () => {
    expect(() =>
      tokensCommand.run(tokensCommand.parse(["m.json", "--sort", "nope"])),
    ).toThrow("--sort must be one of token, asFrom, asToWeight");
  });

  it("accepts the declared options of each command", () => {
    expect(corpusCommand.parse(["m.json", "--tail", "2"]).tail).toBe("2");
    expect(unlearnCommand.parse(["m.json", "2", "-i.bak"])).toMatchObject({
      "in-place": true,
      suffix: ".bak",
    });
    expect(
      decrementPhraseCommand.parse(["m.json", "a/b", "-d/", "--delta", "2"]),
    ).toMatchObject({ delta: "2", delimiter: "/" });
    expect(tokensCommand.parse(["m.json", "--sort", "token"]).sort).toBe(
      "token",
    );
    expect(transitionsCommand.parse(["m.json", "a/b", "-d/"]).delimiter).toBe(
      "/",
    );
    expect(searchCommand.parse(["m.json", "beige"]).query).toBe("beige");
  });
});
