import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import { UsageError } from "../command";
import { captureOutput, modelFixture } from "../testLib";
import { unlearn } from "./unlearn";

/** 1 文だけ学習したモデル。`n=1` でその 1 文を消せる。 */
const fixture = () =>
  modelFixture("unlearn", {
    model: { "": { あ: 1 }, あ: { "。": 1 } },
    corpus: ["あ。"],
  });

/** `--in-place` と `--suffix` だけを受けるコマンドであることを確かめる。 */
const expectOnlyWriteBackOptions = (): void => {
  expect(unlearn.usage).toBe("unlearn <modelPath> <n> [-i] [--suffix]");
  expect(Object.keys(unlearn.options)).toEqual(["in-place", "suffix"]);
  expect(
    unlearn.parse(["m.json", "2", "-i", "--suffix", ".bak"]),
  ).toMatchObject({
    modelPath: "m.json",
    n: "2",
    "in-place": true,
    suffix: ".bak",
  });
};

/** 他のコマンドのオプションを弾くことを確かめる。短縮形は名前でなく型で確かめる。 */
const expectRejected = (...options: readonly string[]): void => {
  for (const option of options) {
    expect(() => unlearn.parse(["m.json", "1", option, "2"])).toThrow(
      UsageError,
    );
    expect(() => unlearn.parse(["m.json", "1", option, "2"])).toThrow(
      option.startsWith("--") ? option : "Unknown option",
    );
  }
};

describe("unlearn options", () => {
  it(
    "takes --in-place and --suffix as its only options",
    expectOnlyWriteBackOptions,
  );

  it("takes no option that another command declares", () => {
    expectRejected("--tail", "--sort", "--delta", "--purge", "-d");
  });

  it("rejects an n that is not a positive integer", () => {
    expect(() => unlearn.parse(["m.json", "x"])).toThrow(
      "n must be a positive integer, got x",
    );
    expect(() => unlearn.parse(["m.json", "0"])).toThrow(
      "n must be a positive integer, got 0",
    );
  });
});

describe("unlearn", () => {
  it("rejects an n past the oldest entry", () => {
    const model = fixture();
    expect(() => unlearn.run(unlearn.parse([model.modelPath, "3"]))).toThrow(
      "n=3 out of range (corpus length 1)",
    );
    model.remove();
  });

  it("prints the updated model to stdout and leaves the file alone", () => {
    const model = fixture();
    const { stdout, stderr } = captureOutput(() =>
      unlearn.run(unlearn.parse([model.modelPath, "1"])),
    );
    expect(stderr).toBe('unlearn n=1 from-end text="あ。"\ncorpus: 1 => 0');
    expect(JSON.parse(stdout).corpus).toEqual([]);
    expect(JSON.parse(readFileSync(model.modelPath, "utf8")).corpus).toEqual([
      "あ。",
    ]);
    model.remove();
  });

  it("writes the model back and prints no JSON with --in-place", () => {
    const model = fixture();
    const { stdout, stderr } = captureOutput(() =>
      unlearn.run(unlearn.parse([model.modelPath, "1", "-i"])),
    );
    expect(stdout).toBe("");
    expect(stderr).toContain(`wrote: ${model.modelPath}`);
    expect(JSON.parse(readFileSync(model.modelPath, "utf8")).corpus).toEqual(
      [],
    );
    model.remove();
  });

  it("copies <modelPath><suffix> before --in-place writes", () => {
    const model = fixture();
    captureOutput(() =>
      unlearn.run(
        unlearn.parse([model.modelPath, "1", "--suffix", ".bak", "-i"]),
      ),
    );
    expect(existsSync(`${model.modelPath}.bak`)).toBe(true);
    expect(
      JSON.parse(readFileSync(`${model.modelPath}.bak`, "utf8")).corpus,
    ).toEqual(["あ。"]);
    expect(JSON.parse(readFileSync(model.modelPath, "utf8")).corpus).toEqual(
      [],
    );
    model.remove();
  });

  it("keeps the backup out of the way without --suffix", () => {
    const model = fixture();
    captureOutput(() =>
      unlearn.run(unlearn.parse([model.modelPath, "1", "-i"])),
    );
    expect(existsSync(`${model.modelPath}.bak`)).toBe(false);
    model.remove();
  });
});
