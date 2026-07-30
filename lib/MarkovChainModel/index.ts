import { readFileSync } from "node:fs";
import { MarkovModel } from "automated-gameplay-transmitter";
import type { TalkModel } from "../Agent";

const jaJP = new Intl.Locale('ja-JP');

type WeightedCandidates = Record<string, number>;

type Distribution = {
  /** initial word candidates */
  '': WeightedCandidates

  [k: string]: WeightedCandidates
};
const DEFAULT_MAX_LEARN_CONTEXT = 8;

const normalizeNGram = (nGram: number): number => Math.max(1, Math.floor(nGram));

/** Ensures text passed to AGT learn API is always a single Japanese sentence terminator suffix. */
const normalizeLearnText = (text: string): `${string}。` => (
  `${text.replace(/。+$/u, '')}。` satisfies `${string}。`
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
    const dist = json.model ?? { '': { '。': 1 } };
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
      dist,
      [],
      this.#maxLearnContext,
    );
  }

  /**
   * Generate text from the Markov model.
   *
   * @param start - Seed word to begin generation from.
   * @param nGram - N-gram order to use during generation.
   * @returns A string when trace is unavailable or a trace object when the
   *          underlying AGT model supports it.
   */
  generate(
    start: string = '',
    nGram = 1,
  ): string | { text: string; nodes?: string[] } {
    const result = this.#model.gen(start, normalizeNGram(nGram), { trace: true });
    if (typeof result === 'string') {
      return result;
    }

    const nodes = Array.isArray(result.nodes) ? result.nodes.map(String) : undefined;
    const startToken = start.trim();
    return {
      text: result.text,
      nodes: startToken && nodes ? [startToken, ...nodes] : nodes,
    };
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

  decrementPhrase(tokens: string[], delta = 1): MarkovChainModel {
    if (tokens.length === 0 || delta === 0) return this;
    const current = this.#model.json as { model: Distribution; corpus: string[] };
    const model = current.model;
    const corpus = current.corpus;
    const next: Distribution = { '': {} };
    for (const [from, cands] of Object.entries(model)) {
      next[from] = { ...cands };
    }
    const dec = (key: string, token: string) => {
      if (!next[key] || next[key][token] == null) return;
      next[key][token] -= delta;
      if (next[key][token] <= 0) delete next[key][token];
      if (Object.keys(next[key]).length === 0) delete next[key];
    };
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (i === 0) dec("", token);
      const maxN = Math.min(this.#maxLearnContext, i);
      for (let n = 1; n <= maxN; n++) {
        const context = tokens.slice(i - n, i).join("\u0000");
        dec(context, token);
      }
    }

    // Weaken outgoing edges from n-gram state keys equal to the phrase,
    // or containing the phrase as consecutive segments.
    const phraseParts = tokens;
    const keyHasPhrase = (from: string): boolean => {
      if (from === tokens.join("\u0000")) return true;
      const segs = from.split("\u0000");
      for (let i = 0; i <= segs.length - phraseParts.length; i++) {
        if (phraseParts.every((tok, j) => segs[i + j] === tok)) return true;
      }
      return false;
    };
    for (const from of Object.keys(next)) {
      if (!keyHasPhrase(from)) continue;
      for (const to of Object.keys({ ...next[from] })) {
        dec(from, to);
      }
    }


    if (!next[""] || Object.keys(next[""]).length === 0) next[""] = { "。": 1 };
    return MarkovChainModel.#fromJson({ model: next, corpus }, this.#maxLearnContext);
  }

  tokenStats(): { token: string; asFrom: number; asToWeight: number }[] {
    const { model } = this.#model.json as { model: Distribution; corpus: string[] };
    const map = new Map();
    for (const [from, cands] of Object.entries(model)) {
      if (from !== "") {
        const cur = map.get(from) ?? { asFrom: 0, asToWeight: 0 };
        cur.asFrom += Object.keys(cands).length;
        map.set(from, cur);
      }
      for (const [to, w] of Object.entries(cands)) {
        const cur = map.get(to) ?? { asFrom: 0, asToWeight: 0 };
        cur.asToWeight += w;
        map.set(to, cur);
      }
    }
    return [...map.entries()]
      .map(([token, v]) => ({ token, ...v }))
      .sort((a, b) => (b.asToWeight + b.asFrom) - (a.asToWeight + a.asFrom));
  }

  transitionsOf(wordOrPhrase: string): {
    asFrom: WeightedCandidates;
    asTo: { from: string; weight: number }[];
    fromContexts: { context: string; next: string; weight: number }[];
  } {
    const { model } = this.#model.json as { model: Distribution; corpus: string[] };
    const key = wordOrPhrase.trim().split(/\s+/).filter(Boolean).join("\u0000");
    const needle = key.split("\u0000");
    const asFrom = { ...(model[key] ?? {}) };
    const asTo: { from: string; weight: number }[] = [];
    const fromContexts: { context: string; next: string; weight: number }[] = [];

    const contextContains = (from: string): boolean => {
      if (from === key) return true;
      const segs = from.split("\u0000");
      if (needle.length === 1) {
        return segs.includes(needle[0]!);
      }
      for (let i = 0; i <= segs.length - needle.length; i++) {
        if (needle.every((tok, j) => segs[i + j] === tok)) return true;
      }
      return false;
    };

    for (const [from, cands] of Object.entries(model)) {
      const toWeight = cands[key] ?? (needle.length === 1 ? cands[needle[0]!] : undefined);
      if (toWeight != null) asTo.push({ from, weight: toWeight });

      if (contextContains(from)) {
        for (const [next, w] of Object.entries(cands)) {
          fromContexts.push({ context: from, next, weight: w });
        }
      }
    }
    fromContexts.sort((a, b) => b.weight - a.weight);
    asTo.sort((a, b) => b.weight - a.weight);
    return { asFrom, asTo, fromContexts };
  }

};
