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
const LEGACY_CONTEXT_SEPARATOR = '\u0001';
const AGT_CONTEXT_SEPARATOR = '\u0000';

/** Ensures text passed to AGT learn API is always a single Japanese sentence terminator suffix. */
const normalizeLearnText = (text: string): `${string}。` => (
  `${text.replace(/。+$/u, '')}。` satisfies `${string}。`
);

/** Converts legacy context keys (`\u0001`) in saved model files to AGT v0.6.1 separator (`\u0000`). */
const migrateLegacyDistribution = (dist: Distribution): Distribution => (
  Object.entries(dist).reduce<Distribution>((migrated, [key, cands]) => {
    const migratedKey = key.replaceAll(LEGACY_CONTEXT_SEPARATOR, AGT_CONTEXT_SEPARATOR);
    const merged = migrated[migratedKey] ?? {};
    for (const [word, weight] of Object.entries(cands)) {
      merged[word] = (merged[word] ?? 0) + weight;
    }
    migrated[migratedKey] = merged;
    return migrated;
  }, { '': {} })
);

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
 * const text = model.generate('', 2);
 * console.log(text);
 */
export class MarkovChainModel implements TalkModel {
  #model: ReturnType<typeof MarkovModel.create>;
  /** Effective learn-context limit used when creating/deriving AGT MarkovModel instances. */
  #maxLearnContext: number;
  /** Rehydrates MarkovChainModel from AGT JSON snapshot with validated context limit. */
  static #fromJson(
    json: {
      model?: Distribution
      corpus?: string[]
    },
    maxLearnContext = DEFAULT_MAX_LEARN_CONTEXT,
  ): MarkovChainModel {
    const validatedMaxLearnContext = Math.max(1, Math.floor(maxLearnContext));
    const dist = migrateLegacyDistribution(json.model ?? { '': { '。': 1 } });
    const instance = new MarkovChainModel(dist, { maxLearnContext: validatedMaxLearnContext });
    instance.#model = MarkovModel.create(
      dist,
      json.corpus ?? [],
      validatedMaxLearnContext,
    );
    return instance;
  }

  constructor(
    dist: Distribution = { '': { '。': 1 } },
    {
      maxLearnContext,
    } = {
      maxLearnContext: DEFAULT_MAX_LEARN_CONTEXT,
    },
  ) {
    this.#maxLearnContext = Math.max(1, Math.floor(maxLearnContext));
    this.#model = MarkovModel.create(
      migrateLegacyDistribution(dist),
      [],
      this.#maxLearnContext,
    );
  }

  generate(
    start: string = '',
    nGram = 1,
  ): string {
    // Delegates n-gram generation to AGT's MarkovModel implementation.
    return this.#model.gen(start, nGram);
  }

  learn(text: string): void {
    this.#model.learn(normalizeLearnText(text));
  }

  toLearned(text: string): MarkovChainModel {
    const copied = this.#model.toLearned(normalizeLearnText(text)).json;
    return MarkovChainModel.#fromJson(copied, this.#maxLearnContext);
  }

  static fromFile(path: string): MarkovChainModel {
    const {
      model = { '': { '。': 1 } },
      corpus = [],
    } = JSON.parse(readFileSync(path, { encoding: 'utf-8' }));
    return MarkovChainModel.#fromJson({ model, corpus }, DEFAULT_MAX_LEARN_CONTEXT);
  }

  toJSON(): string {
    return JSON.stringify(this.#model.json, null, 0);
  }
};
