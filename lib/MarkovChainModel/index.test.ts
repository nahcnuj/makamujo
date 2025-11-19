import { describe, expect, it, jest, test } from "bun:test";
import { MarkovChainModel } from ".";

describe('an empty markov chain model', () => {
  it('should generate just "。"', () => {
    const model = new MarkovChainModel();
    expect(model.generate()).toBe('。');
  });
});

describe('a no-branch model', () => {
  it('should generate always the same sentence', () => {
    const model = new MarkovChainModel({
      '': {
        'こ': 1,
      },
      'こ': {
        'ん': 1,
      },
      'ん': {
        '。': 1,
      },
    });
    expect(model.generate()).toBe('こん。');
    expect(model.generate('', 0)).toBe('');
    expect(model.generate('', 1)).toBe('こ');
    expect(model.generate('', 2)).toBe('こん');
    expect(model.generate('', 3)).toBe('こん。');
    expect(model.generate('', 4)).toBe('こん。');

    expect(model.generate('')).toBe('こん。');
    expect(model.generate('こ')).toBe('こん。');
    expect(model.generate('ん')).toBe('ん。');
    expect(model.generate('。')).toBe('。');
  });
});

describe('a distribution including candidates for "。"', () => {
  it('should stop after "。" reached', () => {
    const model = new MarkovChainModel({
      '': { '。': 1 },
      '。': { 'ん': 1 },
    });
    expect(model.generate()).toBe('。');
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
    for (const i in [...new Array(times)]) {
      jest.spyOn(Math, 'random').mockReturnValue(Number.parseInt(i) / times);
      const got = model.generate() as 'こんにちは。' | 'こんばんは。';
      expect(got).toBeOneOf(['こんにちは。', 'こんばんは。']);
      counts[got]++;
    }
    expect(counts["こんにちは。"]).toStrictEqual(counts["こんばんは。"]);
  });
});
