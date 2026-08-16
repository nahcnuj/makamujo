import { readFileSync } from "node:fs";
import { MarkovModel } from "automated-gameplay-transmitter";
import type { TalkModel } from "../Agent";

const _jaJP = new Intl.Locale("ja-JP");

type WeightedCandidates = Record<string, number>;

export type DecrementPhraseOptions =
  | { readonly purge: true; readonly delta?: never }
  | { readonly purge?: false; readonly delta?: number };

type Distribution = {
  /** initial word candidates */
  "": WeightedCandidates;

  [k: string]: WeightedCandidates;
};
const DEFAULT_MAX_LEARN_CONTEXT = 8;

const normalizeNGram = (nGram: number): number =>
  Math.max(1, Math.floor(nGram));

/** Ensures text passed to AGT learn API is always a single Japanese sentence terminator suffix. */
const normalizeLearnText = (text: string): `${string}。` =>
  `${text.replace(/。+$/u, "")}。` satisfies `${string}。`;


const wordSegmenter = new Intl.Segmenter("ja", { granularity: "word" });

/** Tokenize like learn-side Japanese word splits (non-whitespace segments). */
export const segmentLearnText = (text: string): string[] => {
  const normalized = normalizeLearnText(text);
  return [...wordSegmenter.segment(normalized)]
    .map((s) => s.segment)
    .filter((s) => s.trim().length > 0);
};


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
      model?: Distribution;
      corpus?: string[];
    },
    maxLearnContext = DEFAULT_MAX_LEARN_CONTEXT,
  ): MarkovChainModel {
    const validatedMaxLearnContext = Math.max(1, Math.floor(maxLearnContext));
    const dist = json.model ?? { "": { "。": 1 } };
    const instance = new MarkovChainModel(dist, {
      maxLearnContext: validatedMaxLearnContext,
    });
    instance.#model = MarkovModel.create(
      dist,
      json.corpus ?? [],
      validatedMaxLearnContext,
    );
    return instance;
  }

  constructor(
    dist: Distribution = { "": { "。": 1 } },
    { maxLearnContext } = {
      maxLearnContext: DEFAULT_MAX_LEARN_CONTEXT,
    },
  ) {
    this.#maxLearnContext = Math.max(1, Math.floor(maxLearnContext));
    this.#model = MarkovModel.create(dist, [], this.#maxLearnContext);
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
    start: string = "",
    nGram = 1,
  ): string | { text: string; nodes?: string[] } {
    const result = this.#model.gen(start, normalizeNGram(nGram), {
      trace: true,
    });
    if (typeof result === "string") {
      return result;
    }

    const nodes = Array.isArray(result.nodes)
      ? result.nodes.map(String)
      : undefined;
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
    const { model = { "": { "。": 1 } }, corpus = [] } = JSON.parse(
      readFileSync(path, { encoding: "utf-8" }),
    );
    return MarkovChainModel.#fromJson(
      { model, corpus },
      DEFAULT_MAX_LEARN_CONTEXT,
    );
  }

  toJSON(): string {
    return JSON.stringify(this.#model.json, null, 0);
  }

  decrementPhrase(
    tokens: string[],
    opts: DecrementPhraseOptions = { delta: 1 },
  ): MarkovChainModel {
    if (tokens.length === 0) return this;

    const current = this.#model.json as {
      model: Distribution;
      corpus: string[];
    };
    const model = current.model;
    const corpus = current.corpus;
    const next: Distribution = { "": {} };
    for (const [from, cands] of Object.entries(model)) {
      next[from] = { ...cands };
    }

    const phraseKey = tokens.join("\u0000");
    const keyHasConsecutivePhrase = (from: string): boolean => {
      if (from === phraseKey) return true;
      const segs = from.split("\u0000");
      for (let i = 0; i <= segs.length - tokens.length; i++) {
        if (tokens.every((tok, j) => segs[i + j] === tok)) return true;
      }
      return false;
    };

    const dec = (key: string, token: string, amount: number) => {
      const cands = next[key];
      if (!cands || cands[token] == null) return;
      cands[token]! -= amount;
      if (cands[token]! <= 0) delete cands[token];
      if (Object.keys(cands).length === 0) delete next[key];
    };

    const pathEdges = (): { from: string; to: string }[] => {
      const edges: { from: string; to: string }[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const to = tokens[i]!;
        if (i === 0) {
          edges.push({ from: "", to });
        }
        const maxN = Math.min(this.#maxLearnContext, i);
        for (let n = 1; n <= maxN; n++) {
          edges.push({
            from: tokens.slice(i - n, i).join("\u0000"),
            to,
          });
        }
      }
      return edges;
    };

    if (opts.purge === true) {
      if (tokens.length === 1) {
        const tok = tokens[0]!;
        for (const from of Object.keys(next)) {
          if (from.split("\u0000").includes(tok)) {
            delete next[from];
            continue;
          }
          const cands = next[from];
          if (cands && cands[tok] != null) {
            delete cands[tok];
            if (Object.keys(cands).length === 0) delete next[from];
          }
        }
      } else {
        // Multi-token purge: subtract min weight along phrase path edges
        const edges = pathEdges();
        let minW = Infinity;
        for (const { from, to } of edges) {
          const w = next[from]?.[to] ?? 0;
          if (w < minW) minW = w;
        }
        if (minW > 0) {
          for (const { from, to } of edges) {
            dec(from, to, minW);
          }
          // consecutive phrase state keys: weaken all outgoings by min
          for (const from of Object.keys(next)) {
            if (!keyHasConsecutivePhrase(from)) continue;
            const cands = next[from];
            if (!cands) continue;
            for (const to of Object.keys(cands)) {
              dec(from, to, minW);
            }
          }
        }
      }
    } else {
      const delta = opts.delta ?? 1;
      if (delta === 0) return this;

      for (let i = 0; i < tokens.length; i++) {
        const to = tokens[i]!;
        if (i === 0) dec("", to, delta);
        const maxN = Math.min(this.#maxLearnContext, i);
        for (let n = 1; n <= maxN; n++) {
          const context = tokens.slice(i - n, i).join("\u0000");
          dec(context, to, delta);
        }
      }

      for (const from of Object.keys(next)) {
        if (!keyHasConsecutivePhrase(from)) continue;
        const cands = next[from];
        if (!cands) continue;
        for (const to of Object.keys(cands)) {
          dec(from, to, delta);
        }
      }
    }

    if (!next[""] || Object.keys(next[""]).length === 0) next[""] = { "。": 1 };
    return MarkovChainModel.#fromJson(
      { model: next, corpus },
      this.#maxLearnContext,
    );
  }


  /** corpus length (learned sentences, append order; end is newest). */
  corpusLength(): number {
    const { corpus = [] } = this.#model.json as { corpus?: string[] };
    return corpus.length;
  }

  /**
   * Sentence at 1-based index from the end (1 = newest).
   * Returns undefined if out of range.
   */
  corpusFromEnd(n: number): string | undefined {
    const nth = Math.floor(n);
    if (nth < 1) return undefined;
    const { corpus = [] } = this.#model.json as { corpus?: string[] };
    const idx = corpus.length - nth;
    if (idx < 0 || idx >= corpus.length) return undefined;
    return corpus[idx];
  }

  /**
   * Unlearn one corpus entry: transition weights -1 (same as one learn),
   * then remove that single corpus string (by index from end).
   * n is 1-based from the end (1 = newest).
   */
  unlearnFromEnd(n: number): MarkovChainModel {
    const nth = Math.floor(n);
    if (nth < 1) {
      throw new RangeError(`n must be >= 1, got ${n}`);
    }
    const current = this.#model.json as {
      model: Distribution;
      corpus: string[];
    };
    const corpus = current.corpus ?? [];
    const idx = corpus.length - nth;
    if (idx < 0 || idx >= corpus.length) {
      throw new RangeError(
        `n=${nth} out of range (corpus length ${corpus.length})`,
      );
    }
    const text = corpus[idx]!;
    const tokens = segmentLearnText(text);
    const decremented = this.decrementPhrase(tokens, { delta: 1 });
    const next = JSON.parse(decremented.toJSON()) as {
      model: Distribution;
      corpus: string[];
    };
    const nextCorpus = [...(next.corpus ?? [])];
    // Same index: decrementPhrase does not change corpus order/length
    if (nextCorpus[idx] !== text) {
      // Fallback: remove first matching from end-side scan
      let removed = false;
      for (let i = nextCorpus.length - 1; i >= 0; i--) {
        if (nextCorpus[i] === text) {
          nextCorpus.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (!removed) {
        // still drop by original idx if lengths match
        if (idx < nextCorpus.length) nextCorpus.splice(idx, 1);
      }
    } else {
      nextCorpus.splice(idx, 1);
    }
    return MarkovChainModel.#fromJson(
      { model: next.model, corpus: nextCorpus },
      this.#maxLearnContext,
    );
  }

  tokenStats(): { token: string; asFrom: number; asToWeight: number }[] {
    const { model } = this.#model.json as {
      model: Distribution;
      corpus: string[];
    };
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
      .sort((a, b) => b.asToWeight + b.asFrom - (a.asToWeight + a.asFrom));
  }

  transitionsOf(wordOrPhrase: string): {
    asFrom: WeightedCandidates;
    asTo: { from: string; weight: number }[];
    fromContexts: { context: string; next: string; weight: number }[];
  } {
    const { model } = this.#model.json as {
      model: Distribution;
      corpus: string[];
    };
    const key = wordOrPhrase.trim().split(/\s+/).filter(Boolean).join("\u0000");
    const needle = key.split("\u0000");
    const asFrom = { ...(model[key] ?? {}) };
    const asTo: { from: string; weight: number }[] = [];
    const fromContexts: { context: string; next: string; weight: number }[] =
      [];

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
      const toWeight =
        cands[key] ?? (needle.length === 1 ? cands[needle[0]!] : undefined);
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
}
