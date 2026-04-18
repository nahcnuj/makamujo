import { readFileSync } from "node:fs";
import { MarkovModel } from "automated-gameplay-transmitter";
import type { TalkModel } from "../Agent";

type WeightedCandidates = Record<string, number>;

type Distribution = {
  /** initial word candidates */
  '': WeightedCandidates

  [k: string]: WeightedCandidates
};
const DEFAULT_MAX_LEARN_CONTEXT = 8;

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
  #model: ReturnType<typeof MarkovModel.create>;

  constructor(
    dist: Distribution = { '': { '。': 1 } },
    {
      locale,
      maxLearnContext,
    } = {
      locale: new Intl.Locale('ja-JP'),
      maxLearnContext: DEFAULT_MAX_LEARN_CONTEXT,
    },
  ) {
    this.#model = MarkovModel.create(
      dist,
      [],
      Math.max(1, Math.floor(maxLearnContext)),
    );
  }

  generate(
    start: string = '',
    nGram = 1,
  ): string {
    return this.#model.gen(start, nGram);
  }

  learn(text: string): void {
    this.#model.learn(text as `${string}。`);
  }

  toLearned(text: string): MarkovChainModel {
    const copied = this.#model.toLearned(text as `${string}。`).json;
    return new MarkovChainModel(copied.model);
  }

  static fromFile(path: string): MarkovChainModel {
    const {
      model = undefined,
      corpus = [],
    } = JSON.parse(readFileSync(path, { encoding: 'utf-8' }));
    const instance = new MarkovChainModel();
    instance.#model = MarkovModel.create(model, corpus);
    return instance;
  }

  toJSON(): string {
    return JSON.stringify(this.#model.json, null, 0);
  }
};
