import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import { UsageError } from "../command";
import { captureOutput, modelFixture } from "../testLib";
import { decrementPhrase } from "./decrementPhrase";

/** `beige panty` を弱められるモデル。`--purge` 用に別の文脈 `no` も入れてある。 */
const fixture = () =>
  modelFixture("decrement-phrase", {
    model: { "": { beige: 2, x: 1 }, beige: { panty: 3 }, no: { beige: 3 } },
    corpus: [],
  });

const updatedModelOf = (
  stdout: string,
): Record<string, Record<string, number>> => JSON.parse(stdout).model;

/** このコマンドが宣言するオプションだけを確かめる。 */
const expectOwnOptions = (): void => {
  expect(decrementPhrase.usage).toBe(
    "decrement-phrase <modelPath> <phrase> [--delta] [--purge] [-i] [--suffix] [-d]",
  );
  expect(Object.keys(decrementPhrase.options)).toEqual([
    "delta",
    "purge",
    "in-place",
    "suffix",
    "delimiter",
  ]);
  expect(
    decrementPhrase.parse(["m.json", "a b", "-d/", "--delta", "2", "-i"]),
  ).toMatchObject({ delta: "2", delimiter: "/", "in-place": true });
};

/** 他のコマンドのオプションを弾くことを確かめる。短縮形は名前でなく型で確かめる。 */
const expectRejected = (...options: readonly string[]): void => {
  for (const option of options) {
    expect(() =>
      decrementPhrase.parse(["m.json", "phrase", option, "2"]),
    ).toThrow(UsageError);
    expect(() =>
      decrementPhrase.parse(["m.json", "phrase", option, "2"]),
    ).toThrow(option.startsWith("--") ? option : "Unknown option");
  }
};

describe("decrement-phrase options", () => {
  it("takes --delta --purge --in-place --suffix -d", expectOwnOptions);

  it("takes no option that another command declares", () => {
    expectRejected("--tail", "--sort");
  });

  it("rejects a --delta that is not a positive integer", () => {
    expect(() =>
      decrementPhrase.parse(["m.json", "phrase", "--delta", "abc"]),
    ).toThrow("--delta must be a positive integer, got abc");
    expect(() =>
      decrementPhrase.parse(["m.json", "phrase", "--delta", "0"]),
    ).toThrow("--delta must be a positive integer, got 0");
  });

  it("rejects --purge together with --delta", () => {
    expect(() =>
      decrementPhrase.run(
        decrementPhrase.parse(["m.json", "phrase", "--purge", "--delta", "1"]),
      ),
    ).toThrow("--purge and --delta cannot be used together");
  });

  it("rejects a phrase with no token", () => {
    expect(() =>
      decrementPhrase.run(decrementPhrase.parse(["m.json", " "])),
    ).toThrow("phrase is empty");
    expect(() =>
      decrementPhrase.run(decrementPhrase.parse(["m.json", " / ", "-d/"])),
    ).toThrow("phrase is empty");
  });
});

describe("decrement-phrase", () => {
  it("subtracts 1 from the phrase by default and logs the diff to stderr", () => {
    const model = fixture();
    const { stdout, stderr } = captureOutput(() =>
      decrementPhrase.run(
        decrementPhrase.parse([model.modelPath, "beige panty"]),
      ),
    );
    expect(updatedModelOf(stdout)).toEqual({
      "": { beige: 1, x: 1 },
      beige: { panty: 2 },
      no: { beige: 3 },
    });
    expect(stderr).toContain(
      'decrement-phrase delta=1 tokens=["beige","panty"]',
    );
    expect(stderr).toContain("(BOS) -> beige: 2 => 1");
    expect(stderr).toContain("beige -> panty: 3 => 2");
    expect(stderr).toContain("changed: 2 transitions");
    model.remove();
  });

  it("subtracts N for --delta and drops the edges that reach 0", () => {
    const model = fixture();
    const { stdout } = captureOutput(() =>
      decrementPhrase.run(
        decrementPhrase.parse([model.modelPath, "beige panty", "--delta", "2"]),
      ),
    );
    expect(updatedModelOf(stdout)).toEqual({
      "": { x: 1 },
      beige: { panty: 1 },
      no: { beige: 3 },
    });
    model.remove();
  });

  it("drops the token from every context for --purge", () => {
    const model = fixture();
    const { stdout, stderr } = captureOutput(() =>
      decrementPhrase.run(
        decrementPhrase.parse([model.modelPath, "beige", "--purge"]),
      ),
    );
    expect(updatedModelOf(stdout)).toEqual({ "": { x: 1 } });
    expect(stderr).toContain('decrement-phrase purge tokens=["beige"]');
    expect(stderr).toContain("no -> beige: 3 => 0");
    model.remove();
  });

  it("splits the phrase with the delimiter of -d", () => {
    const model = fixture();
    const { stdout, stderr } = captureOutput(() =>
      decrementPhrase.run(
        decrementPhrase.parse([model.modelPath, "beige/panty", "-d/"]),
      ),
    );
    expect(stderr).toContain('tokens=["beige","panty"]');
    expect(updatedModelOf(stdout)).toEqual({
      "": { beige: 1, x: 1 },
      beige: { panty: 2 },
      no: { beige: 3 },
    });
    model.remove();
  });

  it("writes the model back and prints no JSON with --in-place", () => {
    const model = fixture();
    const { stdout } = captureOutput(() =>
      decrementPhrase.run(
        decrementPhrase.parse([
          model.modelPath,
          "beige panty",
          "-i",
          "--suffix",
          ".bak",
        ]),
      ),
    );
    expect(stdout).toBe("");
    expect(updatedModelOf(readFileSync(model.modelPath, "utf8"))).toEqual({
      "": { beige: 1, x: 1 },
      beige: { panty: 2 },
      no: { beige: 3 },
    });
    expect(existsSync(`${model.modelPath}.bak`)).toBe(true);
    model.remove();
  });
});
