import { readFileSync } from "node:fs";
import type { TalkModel } from "../Agent";
import { choose } from "./choose";

type WeightedCandidates = Record<string, number>;

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
  }

  *#generator(start: string) {
    let word = start;
    let byteLength = lengthInUtf8(word);
    do {
      const cands = this.#dist[word];
      if (!cands || Object.keys(cands).length <= 0) {
        console.warn(`No candidates after "${word}"`);
        break;
      }
      word = pick(cands);

      if (Array.from(this.#graphemeSegmenter.segment(word)).map(({ segment }) => segment).length === 1 && word.match(/[\p{Script=Hiragana}]/u)) {
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

  learn(text: string): void {
    for (const { segment: sentence } of this.#sentenceSegmenter.segment(text)) {
      console.debug('[DEBUG]', 'learn a sentence', sentence);

      this.#corpus.push(sentence);

      Array.from(this.#wordSegmenter.segment(sentence)).map(({ segment }) => segment)
        .reduce<string>((prev, next) => {
          if (prev !== '' || acceptBeginning(next)) {
            this.#dist[prev] = {
              [next]: 0,
              ...(this.#dist[prev] ?? {}),
            };
            this.#dist[prev][next] = (this.#dist[prev][next] ?? 0) + 1;
          }
          return next;
        }, '');
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
    return JSON.stringify(this.#corpus, null, 0);
  }
};
