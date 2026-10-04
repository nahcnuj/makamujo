import { describe, expect, it } from "bun:test";

import { UsageError } from "./command";
import { markovCommands } from "./commands";

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

/** 表のどこかで宣言されているオプションの名前。 */
const everyOption = [
  ...new Set(markovCommands.flatMap((command) => Object.keys(command.options))),
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

  it("shows only the declared options in <command> --help", () => {
    for (const command of markovCommands) {
      for (const name of everyOption) {
        if (name in command.options) continue;
        expect(command.help).not.toContain(`--${name} `);
      }
      expect(command.help).toContain("-h, --help");
    }
  });
});
