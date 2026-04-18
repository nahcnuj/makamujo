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
    expect(model.generate()).toBe('こんにちは。');
    expect(model.generate('')).toBe('こんにちは。');
    expect(model.generate('こん')).toBe('こんにちは。');
    expect(model.generate('にち')).toBe('にちは。');
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
    const randomSpy = jest.spyOn(Math, 'random');
    for (const i in [...new Array(times)]) {
      randomSpy.mockReturnValue(Number.parseInt(i) / times);
      const got = model.generate() as 'こんにちは。' | 'こんばんは。';
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
    expect(loaded.generate()).toBe('こんにちは。');
  });

  it('migrates legacy context separator from old model files', () => {
    const path = join(tmpdir(), `legacy-markov-model-${Date.now()}.json`);
    temporaryModelFilePaths.push(path);
    writeFileSync(path, JSON.stringify({
      model: {
        '': { 'A': 1 },
        'A': { 'B': 1 },
        'A\u0001B': { 'C': 1 },
        'B\u0001C': { '。': 1 },
      },
      corpus: [],
    }));

    const loaded = MarkovChainModel.fromFile(path);
    expect(loaded.generate('', 2)).toBe('ABC。');
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

    expect(model.generate('', 2)).toBe('ABC。');
  });

  it('falls back to lower-order context when n is smaller', () => {
    const model = new MarkovChainModel({
      '': { 'A': 1 },
      'A': { 'B': 1 },
      'A\u0000B': { 'C': 1 },
      'B': { '。': 1 },
      'C': { '。': 1 },
    });

    expect(model.generate('', 1)).toBe('AB。');
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
