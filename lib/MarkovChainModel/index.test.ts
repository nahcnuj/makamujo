import { beforeEach, describe, expect, it, jest } from "bun:test";
import { MarkovChainModel } from ".";

beforeEach(() => {
  jest.clearAllMocks();
});

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
    expect(model.generate()).toBe('こんにちは 。');
    expect(model.generate('', 0)).toBe('');
    expect(model.generate('', 1)).toBe('こん');
    expect(model.generate('', 2)).toBe('こんにち');
    expect(model.generate('', 3)).toBe('こんにちは ');
    expect(model.generate('', 4)).toBe('こんにちは 。');

    expect(model.generate('')).toBe('こんにちは 。');
    expect(model.generate('こん')).toBe('こんにちは 。');
    expect(model.generate('にち')).toBe('にちは 。');
    expect(model.generate('は')).toBe('は。');
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

describe('息継ぎ', () => {
  it('latin alphabets', () => {
    const model = new MarkovChainModel({
      '': {
        'abcde': 100,
      },
      'abcde': {
        'abcde': 99,
        '。': 1,
      },
    });

    const times = 100;
    for (const _ in [...new Array(times)]) {
      const got = model.generate();
      // console.log(got, got.split(' ').map(s => new TextEncoder().encode(s).byteLength));
      expect(got.split(' ').every(s => new TextEncoder().encode(s).byteLength <= 20)).toBeTrue();
    }
  });

  it('ひらがな', () => {
    const model = new MarkovChainModel({
      '': {
        'あいう': 100,
      },
      'あいう': {
        'あいう': 99,
        '。': 1,
      },
    });

    const times = 100;
    for (const _ in [...new Array(times)]) {
      const got = model.generate();
      // console.log(got, got.split(' ').map(s => new TextEncoder().encode(s).byteLength));
      expect(got.split(' ').every(s => new TextEncoder().encode(s).byteLength <= 20)).toBeTrue();
    }
  });
});

describe('toJSON', () => {
  it('should be parsed again', () => {
    {
      const model = new MarkovChainModel();
      const { model: copied } = JSON.parse(model.toJSON());
      expect(new MarkovChainModel(copied)).toStrictEqual(model);
    }

    {
      const model = new MarkovChainModel({
        '': { 'こん': 2 },
        'こん': { 'にちは': 1, 'ばんは': 1 },
        'にちは': { '。': 1 },
        'ばんは': { '。': 1 },
      });
      const { model: copied } = JSON.parse(model.toJSON());
      expect(new MarkovChainModel(copied)).toStrictEqual(model);
    }
  });
});
