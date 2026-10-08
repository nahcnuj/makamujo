import { describe, expect, it } from "bun:test";

import { UsageError } from "../command";
import { captureOutput, modelFixture } from "../testLib";
import { corpus } from "./corpus";

/** `--tail` だけを受けるコマンドであることを確かめる。 */
const expectOnlyTail = (): void => {
  expect(corpus.usage).toBe("corpus <modelPath> [--tail]");
  expect(Object.keys(corpus.options)).toEqual(["tail"]);
  expect(corpus.parse(["m.json", "--tail", "2"]).tail).toBe("2");
};

/** 他のコマンドのオプションを弾くことを確かめる。短縮形は名前でなく型で確かめる。 */
const expectRejected = (...options: readonly string[]): void => {
  for (const option of options) {
    expect(() => corpus.parse(["m.json", option, "2"])).toThrow(UsageError);
    expect(() => corpus.parse(["m.json", option, "2"])).toThrow(
      option.startsWith("--") ? option : "Unknown option",
    );
  }
};

/** 2 文だけ学習したモデル（末尾が新しい）。 */
const fixture = () =>
  modelFixture("corpus", {
    model: { "": { "。": 1 } },
    corpus: ["古い。", "新しい。"],
  });

describe("corpus options", () => {
  it("takes --tail as its only option", expectOnlyTail);

  it("takes no option that another command declares", () => {
    expectRejected("--sort", "--delta", "--purge", "--in-place", "-i", "-d");
  });

  it("rejects a --tail that is not a positive integer", () => {
    expect(() => corpus.parse(["m.json", "--tail", "0"])).toThrow(
      "--tail must be a positive integer, got 0",
    );
  });
});

describe("corpus output", () => {
  it("numbers every entry from the end of the corpus", () => {
    const model = fixture();
    const { stdout, stderr } = captureOutput(() =>
      corpus.run(corpus.parse([model.modelPath])),
    );
    expect(stdout).toBe("2\t古い。\n1\t新しい。\n");
    expect(stderr).toBe("");
    model.remove();
  });

  it("lists only the newest N entries for --tail", () => {
    const model = fixture();
    const { stdout } = captureOutput(() =>
      corpus.run(corpus.parse([model.modelPath, "--tail", "1"])),
    );
    expect(stdout).toBe("1\t新しい。\n");
    model.remove();
  });

  it("prints nothing when the model has no corpus", () => {
    const model = modelFixture("corpus-empty", { model: { "": { "。": 1 } } });
    const { stdout } = captureOutput(() =>
      corpus.run(corpus.parse([model.modelPath])),
    );
    expect(stdout).toBe("");
    model.remove();
  });
});
