import { readFileSync } from "node:fs";
import type { TalkModel } from "../Agent";
import { choose } from "./choose";

type WeightedCandidates = Record<string, number>;
const CONTEXT_SEPARATOR = '\u0001';

type Distribution = {
  /** initial word candidates */
  '': WeightedCandidates

  [k: string]: WeightedCandidates
};

declare global {
  interface Math {
    /** @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/sumPrecise */
    sumPrecise(args: number[]): number;
  }
}

const pick = (cands: WeightedCandidates) => {
  const total = Math.sumPrecise(Object.values(cands));
  const rnd = Math.floor(Math.random() * total);
  return choose(Object.entries(cands), rnd);
};

const acceptBeginning = (text: string) => [...text].length > 1 || !text.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Punctuation}\p{Modifier_Letter}\p{Other_Symbol}]/u);

const textEncoder = new TextEncoder();
const lengthInUtf8 = (text: string): number => textEncoder.encode(text).byteLength;

/**
 * A word-level Markov chain model.
 * The model provides some helper methods to generate something to talk or replies and learn new sentences.
 * When learned a new sentence, the model is modified itself and writes the modified model out to the given file.
 * 
 * Splitting into words depends on `Intl.Segmenter`.
 *
 * @example
 * const model = new MarkovChainModel();
 * 
 * model.learn('こんにちは。');
 * console.log(JSON.stringify(model.json, null, 2));
 * 
 * const text = model.generate();
 * 
 * const reply = model.reply('元気ですか？');
 * console.log(reply);
 */
export class MarkovChainModel implements TalkModel {
  #dist: Distribution;
  #corpus: string[] = [];
  #maxContextSize = 1;
  #wordSegmenter;
  #sentenceSegmenter;
  #graphemeSegmenter;

  constructor(
    dist: Distribution = { '': { '。': 1 } },
    {
      locale,
    } = {
      locale: new Intl.Locale('ja-JP'),
    },
  ) {
    this.#dist = dist;
    this.#wordSegmenter = new Intl.Segmenter(locale, { granularity: 'word' });
    this.#sentenceSegmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
    this.#graphemeSegmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
    this.#maxContextSize = this.#measureMaxContextSize();
  }

  #measureMaxContextSize(): number {
    return Math.max(1, ...Object.keys(this.#dist).map((key) => key === '' ? 0 : key.split(CONTEXT_SEPARATOR).length));
  }

  #wordSegments(text: string): string[] {
    return Array.from(this.#wordSegmenter.segment(text)).map(({ segment }) => segment);
  }

  #contextKey(words: string[]): string {
    return words.length <= 0 ? '' : words.join(CONTEXT_SEPARATOR);
  }

  #pickCandidates(history: string[], allowEmptyContext = true): WeightedCandidates | undefined {
    for (let contextSize = Math.min(this.#maxContextSize, history.length); contextSize > 0; contextSize--) {
      const cands = this.#dist[this.#contextKey(history.slice(-contextSize))];
      if (cands && Object.keys(cands).length > 0) {
        return cands;
      }
    }
    return allowEmptyContext ? this.#dist[''] : undefined;
  }

  *#generator(start: string) {
    let history = start === '' ? [] : [start];
    let word = start;
    let byteLength = lengthInUtf8(word);
    let firstStep = true;
    do {
      const cands = this.#pickCandidates(history, !(firstStep && start !== ''));
      if (!cands || Object.keys(cands).length <= 0) {
        console.warn(`No candidates after "${word}"`);
        break;
      }
      firstStep = false;
      word = pick(cands);
      history = [...history, word].slice(-this.#maxContextSize);

      if (byteLength > 0 && Array.from(this.#graphemeSegmenter.segment(word)).map(({ segment }) => segment).length === 1 && word.match(/[\p{Script=Hiragana}]/u)) {
        // breathe after the word
        yield `${word} `;
        byteLength = 0;
      } else {
        if (word.match(/[\s\p{Punctuation}]/u)) {
          byteLength = 0;
        } else {
          byteLength += lengthInUtf8(word);
        }

        if (byteLength >= 17) {
          // the phrase seems too long
          yield `${word} `;
          byteLength = 0;
        } else {
          yield word;
        }
      }
    } while (word !== '。');
  }

  generate(start: string = '', limit = Number.POSITIVE_INFINITY): string {
    return start + this.#generator(start).take(limit).toArray().join('');
  }

  learn(text: string, n = 1): void {
    const contextSize = Math.max(1, Math.floor(n));
    this.#maxContextSize = Math.max(this.#maxContextSize, contextSize);

    for (const { segment: sentence } of this.#sentenceSegmenter.segment(text)) {
      console.debug('[DEBUG]', 'learn a sentence', sentence);

      this.#corpus.push(sentence);

      const context: string[] = [];
      for (const next of this.#wordSegments(sentence)) {
        const previous = this.#contextKey(context);
        if (previous !== '' || acceptBeginning(next)) {
          this.#dist[previous] = {
            [next]: 0,
            ...(this.#dist[previous] ?? {}),
          };
          this.#dist[previous][next] = (this.#dist[previous][next] ?? 0) + 1;
        }

        context.push(next);
        if (context.length > contextSize) {
          context.shift();
        }
      }
    }
  }

  toLearned(text: string): MarkovChainModel {
    const model = new MarkovChainModel(this.#dist);
    model.learn(text);
    return model;
  }

  static fromFile(path: string): MarkovChainModel {
    const { model = undefined } = JSON.parse(readFileSync(path, { encoding: 'utf-8' }));
    return new MarkovChainModel(model);
  }

  toJSON(): string {
    const obj = {
      model: this.#dist,
    };
    return JSON.stringify(obj, null, 0);
  }
};
