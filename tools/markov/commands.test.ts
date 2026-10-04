import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { UsageError } from "./command";
import { markovCommands } from "./commands";
import { corpus } from "./commands/corpus";
import { decrementPhrase } from "./commands/decrementPhrase";
import { search } from "./commands/search";
import { tokens } from "./commands/tokens";
import { transitions } from "./commands/transitions";
import { unlearn } from "./commands/unlearn";

const tmpDir = join(import.meta.dir, "../../../var/tmp-markov-commands-test");
const modelPath = join(tmpDir, "model.json");

/**
 * 宣言表そのもの（コマンド → 位置引数 → オプション）。
 * `bun run markov --help` に出る表と同じ文字列を固定する。
 */
const TABLE = [
  "corpus <modelPath> [--tail]",
  "unlearn <modelPath> <n> [-i] [--suffix]",
  "decrement-phrase <modelPath> <phrase> [--delta] [--purge] [-i] [--suffix] [-d]",
  "tokens <modelPath> [--sort]",
  "search <modelPath> <query>",
  "transitions <modelPath> <word> [-d]",
];

describe("markovCommands", () => {
  it("holds every command exactly once, in help order", () => {
    expect(markovCommands.map((command) => command.usage)).toEqual(TABLE);
  });

  it("gives every command a one-line summary", () => {
    for (const command of markovCommands) {
      expect(command.summary.length).toBeGreaterThan(0);
      expect(command.summary).not.toContain("\n");
    }
  });

  it("declares every argument with a description", () => {
    for (const command of markovCommands) {
      for (const [name, { help }] of Object.entries(command.args)) {
        expect(help.length).toBeGreaterThan(0);
        expect(command.usage).toContain(`<${name}>`);
      }
    }
  });

  it("mentions every declared option in its usage", () => {
    for (const command of markovCommands) {
      for (const [name, option] of Object.entries(command.options)) {
        // 短縮形があるオプションは usage では短縮形で出る。
        expect(command.usage).toContain(
          option.short === undefined ? `[--${name}]` : `[-${option.short}]`,
        );
      }
    }
  });

  it("gives every declared option a one-line description", () => {
    for (const command of markovCommands) {
      for (const option of Object.values(command.options)) {
        expect(option.help.length).toBeGreaterThan(0);
        expect(option.help).not.toContain("\n");
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
        const argv = ["m.json", "word", `--${name}`];
        expect(() => command.invoke(argv)).toThrow(UsageError);
        expect(() => command.invoke(argv)).toThrow(`--${name}`);
      }
    }
  });

  it("gives the write-back options only to the two commands that write", () => {
    expect(Object.keys(unlearn.options)).toEqual(["in-place", "suffix"]);
    expect(Object.keys(decrementPhrase.options)).toEqual([
      "delta",
      "purge",
      "in-place",
      "suffix",
      "delimiter",
    ]);
    for (const command of [corpus, tokens, search, transitions]) {
      expect(Object.keys(command.options)).not.toContain("in-place");
    }
  });
});

describe("argument checks that happen before the model is read", () => {
  it("rejects a --tail that is not a positive integer", () => {
    expect(() => corpus.parse(["m.json", "--tail", "0"])).toThrow(
      "--tail must be a positive integer, got 0",
    );
  });

  it("rejects an unlearn index that is not a positive integer", () => {
    expect(() => unlearn.parse(["m.json", "x"])).toThrow(
      "n must be a positive integer, got x",
    );
  });

  it("rejects an unlearn index out of range", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({ model: { "": { あ: 1 } }, corpus: ["あ。"] }),
    );
    expect(() => unlearn.run(unlearn.parse([modelPath, "3"]))).toThrow(
      "n=3 out of range (corpus length 1)",
    );
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects --delta that is not a positive integer", () => {
    expect(() =>
      decrementPhrase.parse(["m.json", "phrase", "--delta", "abc"]),
    ).toThrow("--delta must be a positive integer, got abc");
  });

  it("rejects --purge together with --delta", () => {
    expect(() =>
      decrementPhrase.run(
        decrementPhrase.parse(["m.json", "phrase", "--purge", "--delta", "1"]),
      ),
    ).toThrow("--purge and --delta cannot be used together");
  });

  it("rejects an empty phrase", () => {
    expect(() =>
      decrementPhrase.run(decrementPhrase.parse(["m.json", " ", "-d", " "])),
    ).toThrow("phrase is empty");
  });

  it("rejects a --sort outside the declared choices", () => {
    expect(() => tokens.parse(["m.json", "--sort", "nope"])).toThrow(
      "--sort must be one of token, asFrom, asToWeight",
    );
  });

  it("accepts the declared options of each command", () => {
    expect(corpus.parse(["m.json", "--tail", "2"]).tail).toBe("2");
    expect(
      unlearn.parse(["m.json", "2", "-i", "--suffix", ".bak"]),
    ).toMatchObject({ "in-place": true, suffix: ".bak" });
    expect(
      decrementPhrase.parse(["m.json", "a/b", "-d/", "--delta", "2"]),
    ).toMatchObject({ delta: "2", delimiter: "/" });
    expect(tokens.parse(["m.json", "--sort", "token"]).sort).toBe("token");
    expect(transitions.parse(["m.json", "a/b", "-d/"]).delimiter).toBe("/");
    expect(search.parse(["m.json", "beige"]).query).toBe("beige");
  });
});
