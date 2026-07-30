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

  it("decrements outgoing edges from phrase n-gram state keys", () => {
    const model = new MarkovChainModel({
      "": { beige: 2 },
      beige: { panty: 3 },
      ["beige" + String.fromCharCode(0) + "panty"]: { end: 5, other: 2 },
      ["pre" + String.fromCharCode(0) + "beige" + String.fromCharCode(0) + "panty"]: { end: 4 },
      unrelated: { x: 9 },
    });

    const updated = model.decrementPhrase(["beige", "panty"], 1);
    const m = JSON.parse(updated.toJSON()).model;
    const phraseKey = "beige" + String.fromCharCode(0) + "panty";
    const longKey = "pre" + String.fromCharCode(0) + "beige" + String.fromCharCode(0) + "panty";

    expect(m[""]?.beige).toBe(1);
    expect(m.beige?.panty).toBe(2);
    expect(m[phraseKey]?.end).toBe(4);
    expect(m[phraseKey]?.other).toBe(1);
    expect(m[longKey]?.end).toBe(3);
    expect(m.unrelated?.x).toBe(9);
  });

  it("removes phrase state outgoings when weight reaches zero", () => {
    const phraseKey = "beige" + String.fromCharCode(0) + "panty";
    const model = new MarkovChainModel({
      "": {},
      [phraseKey]: { end: 1 },
    });
    const updated = model.decrementPhrase(["beige", "panty"], 1);
    const m = JSON.parse(updated.toJSON()).model;
    expect(m[phraseKey]).toBeUndefined();
  });


  it("purge removes all edges to tokens and matching n-gram keys", () => {
    const model = new MarkovChainModel({
      "": { beige: 2, other: 1 },
      beige: { panty: 3 },
      no: { panty: 4 },
      ["beige" + String.fromCharCode(0) + "panty"]: { end: 5 },
      ["pre" + String.fromCharCode(0) + "beige" + String.fromCharCode(0) + "panty"]: { end: 4 },
      unrelated: { x: 9 },
    });
    const updated = model.decrementPhrase(["beige", "panty"], 1, { purge: true });
    const m = JSON.parse(updated.toJSON()).model;
    const phraseKey = "beige" + String.fromCharCode(0) + "panty";
    const longKey = "pre" + String.fromCharCode(0) + "beige" + String.fromCharCode(0) + "panty";

    expect(m[""]?.beige).toBeUndefined();
    expect(m[""]?.other).toBe(1);
    expect(m.beige).toBeUndefined();
    expect(m.no?.panty).toBeUndefined();
    expect(m[phraseKey]).toBeUndefined();
    expect(m[longKey]).toBeUndefined();
    expect(m.unrelated?.x).toBe(9);
  });

  it("purge and normal delta remain distinct", () => {
    const model = new MarkovChainModel({
      "": { beige: 5 },
      beige: { panty: 5 },
    });
    const a = JSON.parse(model.decrementPhrase(["beige"], 1).toJSON()).model;
    expect(a[""]?.beige).toBe(4);
    const b = JSON.parse(model.decrementPhrase(["beige"], 1, { purge: true }).toJSON()).model;
    expect(b[""]?.beige).toBeUndefined();
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
    expect(t.fromContexts.some((x) => x.context === "こん" && x.next === "にち")).toBe(true);
    expect(t.fromContexts.some((x) => x.context === "こん" && x.next === "ばん")).toBe(true);
  });

  it("search-like filtering works via tokenStats", () => {
    const hits = model.tokenStats().filter((x) => x.token.includes("こん"));
    expect(hits.some((x) => x.token === "こん")).toBe(true);
  });
});

describe("transitionsOf n-gram contexts", () => {
  const model = new MarkovChainModel({
    "": { "パンティー": 5 },
    "パンティー": { "。": 10, "を": 3 },
    "パンティー\u0000を": { "穿": 2 },
    "の\u0000パンティー": { "。": 7 },
    "あ\u0000の": { "パンティー": 1 },
    "の": { "パンティー": 4 },
    "無関係": { "語": 1 },
  });

  it("fromContexts includes keys that contain the token as a segment", () => {
    const t = model.transitionsOf("パンティー");
    expect(t.fromContexts).toEqual(
      expect.arrayContaining([
        { context: "パンティー", next: "。", weight: 10 },
        { context: "パンティー", next: "を", weight: 3 },
        { context: "パンティー\u0000を", next: "穿", weight: 2 },
        { context: "の\u0000パンティー", next: "。", weight: 7 },
      ]),
    );
    expect(t.fromContexts.some((x) => x.context === "無関係")).toBe(false);
    expect(t.fromContexts.some((x) => x.context === "の")).toBe(false);
  });

  it("asTo includes n-gram keys that transition to the word", () => {
    const t = model.transitionsOf("パンティー");
    expect(t.asTo).toEqual(
      expect.arrayContaining([
        { from: "", weight: 5 },
        { from: "の", weight: 4 },
        { from: "あ\u0000の", weight: 1 },
      ]),
    );
  });

  it("normalizes space-separated phrase to null-separated key", () => {
    const t = model.transitionsOf("パンティー を");
    expect(t.asFrom).toEqual({ "穿": 2 });
    expect(t.fromContexts).toEqual(
      expect.arrayContaining([
        { context: "パンティー\u0000を", next: "穿", weight: 2 },
      ]),
    );
  });
});
