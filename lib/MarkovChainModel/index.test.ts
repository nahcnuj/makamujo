import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarkovChainModel } from ".";

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

const temporaryModelFilePaths: string[] = [];

type MarkovChainModelGenerateResult = ReturnType<MarkovChainModel['generate']>;
const getResultText = (result: MarkovChainModelGenerateResult) =>
  typeof result === 'string' ? result : result.text;

function assertTraceResult(
  result: MarkovChainModelGenerateResult,
): asserts result is Exclude<MarkovChainModelGenerateResult, string> {
  expect(typeof result).not.toBe('string');
}

afterEach(() => {
  while (temporaryModelFilePaths.length > 0) {
    const path = temporaryModelFilePaths.pop();
    if (path) {
      rmSync(path, { force: true });
    }
  }
});

describe('an empty markov chain model', () => {
  it('should generate just "。"', () => {
    const model = new MarkovChainModel();
    expect(getResultText(model.generate())).toBe('。');
  });

  it('should return trace nodes when generating text', () => {
    const model = new MarkovChainModel({
      '': { 'こん': 1 },
      'こん': { 'にち': 1 },
      'にち': { 'は': 1 },
      'は': { '。': 1 },
    });

    const result = model.generate();
    assertTraceResult(result);
    expect(result.text).toBe('こんにちは。');
    expect(result.nodes).toEqual(['こん', 'にち', 'は', '。']);
  });

  it('should include the start token in trace nodes when a start string is provided', () => {
    const model = new MarkovChainModel({
      '': { 'こん': 1 },
      'こん': { 'にち': 1 },
      'にち': { 'は': 1 },
      'は': { '。': 1 },
    });

    const result = model.generate('こん');
    assertTraceResult(result);
    expect(result.text).toBe('こんにちは。');
    expect(result.nodes).toEqual(['こん', 'にち', 'は', '。']);
  });
});

describe('a no-branch model', () => {
  it('should generate always the same sentence', () => {
    const model = new MarkovChainModel({
      '': {
        'こん': 1,
      },
      'こん': {
        'にち': 1,
      },
      'にち': {
        'は': 1,
      },
      'は': {
        '。': 1,
      }
    });
    expect(getResultText(model.generate())).toBe('こんにちは。');
    expect(getResultText(model.generate(''))).toBe('こんにちは。');
    expect(getResultText(model.generate('こん'))).toBe('こんにちは。');
    expect(getResultText(model.generate('にち'))).toBe('にちは。');
    expect(getResultText(model.generate('は'))).toBe('は。');
    expect(getResultText(model.generate('。'))).toBe('。');
  });
});

describe('a distribution including candidates for "。"', () => {
  it('should stop after "。" reached', () => {
    const model = new MarkovChainModel({
      '': { '。': 1 },
      '。': { 'ん': 1 },
    });
    expect(getResultText(model.generate())).toBe('。');
  });
});

describe('a distribution with two even branches', () => {
  const times = 100;
  const model = new MarkovChainModel({
    '': { 'こん': 2 },
    'こん': { 'にちは': 1, 'ばんは': 1 },
    'にちは': { '。': 1 },
    'ばんは': { '。': 1 },
  });
  const counts = {
    'こんにちは。': 0,
    'こんばんは。': 0,
  };

  it('should choose each branch evenly', () => {
    const randomSpy = jest.spyOn(Math, 'random');
    for (const i in [...new Array(times)]) {
      randomSpy.mockReturnValue(Number.parseInt(i) / times);
      const got = getResultText(model.generate()) as 'こんにちは。' | 'こんばんは。';
      expect(got).toBeOneOf(['こんにちは。', 'こんばんは。']);
      counts[got]++;
    }
    expect(counts["こんにちは。"]).toStrictEqual(counts["こんばんは。"]);
  });
});

describe('toJSON', () => {
  it('should include model and corpus', () => {
    const model = new MarkovChainModel();
    model.learn('こんにちは。');

    const copied = JSON.parse(model.toJSON());
    expect('model' in copied).toBeTrue();
    expect('corpus' in copied).toBeTrue();
    expect(copied.corpus).toContain('こんにちは。');
  });
});

describe('fromFile', () => {
  it('restores saved model json', () => {
    const model = new MarkovChainModel({
      '': { 'こん': 1 },
      'こん': { 'にち': 1 },
      'にち': { 'は': 1 },
      'は': { '。': 1 },
    });
    const path = join(tmpdir(), `markov-model-${Date.now()}.json`);
    temporaryModelFilePaths.push(path);
    writeFileSync(path, model.toJSON());

    const loaded = MarkovChainModel.fromFile(path);
    expect(getResultText(loaded.generate())).toBe('こんにちは。');
  });

});

describe('n-gram contexts', () => {
  it('uses higher-order context when available', () => {
    const model = new MarkovChainModel({
      '': { 'A': 1 },
      'A': { 'B': 1 },
      'A\u0000B': { 'C': 1 },
      'B\u0000C': { '。': 1 },
    });

    expect(getResultText(model.generate('', 2))).toBe('ABC。');
  });

  it('falls back to lower-order context when n is smaller', () => {
    const model = new MarkovChainModel({
      '': { 'A': 1 },
      'A': { 'B': 1 },
      'A\u0000B': { 'C': 1 },
      'B': { '。': 1 },
      'C': { '。': 1 },
    });

    expect(getResultText(model.generate('', 1))).toBe('AB。');
  });
});

describe('learn', () => {
  it('accepts text without sentence terminator', () => {
    const model = new MarkovChainModel();
    model.learn('こんにちは');
    const copied = JSON.parse(model.toJSON());
    expect(copied.corpus).toContain('こんにちは。');
  });

  it('normalizes extra trailing sentence terminators', () => {
    const model = new MarkovChainModel();
    model.learn('こんにちは。。。');
    const copied = JSON.parse(model.toJSON());
    expect(copied.corpus).toContain('こんにちは。');
  });

  it('toLearned keeps learned corpus', () => {
    const model = new MarkovChainModel();
    model.learn('こんにちは。');
    const learned = model.toLearned('こんばんは');
    const copied = JSON.parse(learned.toJSON());
    expect(copied.corpus).toContain('こんにちは。');
    expect(copied.corpus).toContain('こんばんは。');
  });
});


describe("decrementPhrase", () => {
  it("decrements transition weights along the given token sequence", () => {
    const model = new MarkovChainModel({
      "": { "あ": 3 },
      "あ": { "んま": 2 },
      "んま": { "り": 2 },
      "あ\u0000んま": { "り": 1 },
      "り": { "。": 1 },
    });
    const updated = model.decrementPhrase(["あ", "んま", "り"], 1);
    const json = JSON.parse(updated.toJSON()).model;
    expect(json[""]?.["あ"]).toBe(2);
    expect(json["あ"]?.["んま"]).toBe(1);
    expect(json["んま"]?.["り"]).toBe(1);
    expect(json["あ\u0000んま"]?.["り"]).toBeUndefined();
  });

  it("removes entries when weight reaches zero or below", () => {
    const model = new MarkovChainModel({
      "": { "x": 1 },
      "x": { "y": 1 },
      "y": { "。": 1 },
    });
    const updated = model.decrementPhrase(["x", "y"], 1);
    const json = JSON.parse(updated.toJSON()).model;
    expect(json[""]?.["x"]).toBeUndefined();
    expect(json["x"]).toBeUndefined();
  });

  it("does not modify corpus", () => {
    const model = new MarkovChainModel();
    model.learn("テスト文。");
    const before = JSON.parse(model.toJSON()).corpus;
    const updated = model.decrementPhrase(["テ", "スト"], 1);
    const after = JSON.parse(updated.toJSON()).corpus;
    expect(after).toEqual(before);
  });

  it("keeps a fallback start distribution when emptied", () => {
    const model = new MarkovChainModel({ "": { "x": 1 } });
    const updated = model.decrementPhrase(["x"], 1);
    const json = JSON.parse(updated.toJSON()).model;
    expect(json[""]).toEqual({ "。": 1 });
  });
});

describe("tokenStats and transitionsOf", () => {
  const model = new MarkovChainModel({
    "": { "こん": 2 },
    "こん": { "にち": 1, "ばん": 1 },
    "にち": { "は": 1 },
    "ばん": { "は": 1 },
    "は": { "。": 1 },
  });

  it("tokenStats returns frequency-like ranking", () => {
    const stats = model.tokenStats();
    expect(stats.length).toBeGreaterThan(0);
    expect(stats[0]!.token).toBeTruthy();
    expect(typeof stats[0]!.asFrom).toBe("number");
    expect(typeof stats[0]!.asToWeight).toBe("number");
  });

  it("transitionsOf returns asFrom and asTo", () => {
    const t = model.transitionsOf("こん");
    expect(t.asFrom).toEqual({ "にち": 1, "ばん": 1 });
    expect(t.asTo.some((x) => x.from === "" && x.weight === 2)).toBe(true);
  });

  it("search-like filtering works via tokenStats", () => {
    const hits = model.tokenStats().filter((x) => x.token.includes("こん"));
    expect(hits.some((x) => x.token === "こん")).toBe(true);
  });
});
