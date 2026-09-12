export const ANONYMOUS_PRESENCE_MS = 10 * 60 * 1_000;

export type UnlearnableTalkModel = {
  learn(text: string): void;
  unlearn(text: string): void;
};

type Bucket = {
  lastSeenMs: number;
  texts: string[];
};

const asSentence = (text: string): string =>
  text.replace(/。+$/u, "").length === 0
    ? "。"
    : `${text.replace(/。+$/u, "")}。`;

/** Display name only. Never userId (onecomme). */
export const anonymousPresenceKey = (name?: string): string => {
  const n = (name ?? "").normalize("NFC").trim();
  return n.length > 0 ? n : "\u0000";
};

export class AnonymousPresenceLearn {
  #buckets = new Map<string, Bucket>();
  #programUrl?: string;

  constructor(
    private readonly talk: UnlearnableTalkModel,
    private readonly ttlMs = ANONYMOUS_PRESENCE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  noteProgram(url?: string): void {
    if (this.#programUrl !== url) {
      this.forgetAll();
      this.#programUrl = url;
    }
  }

  observe(name: string | undefined, comment: string): void {
    this.forgetExpired();
    const key = anonymousPresenceKey(name);
    const text = asSentence(comment);
    const bucket = this.#buckets.get(key) ?? { lastSeenMs: 0, texts: [] };
    bucket.lastSeenMs = this.now();
    bucket.texts.push(text);
    this.#buckets.set(key, bucket);
    this.talk.learn(text);
  }

  forgetExpired(): void {
    const t = this.now();
    for (const [key, bucket] of this.#buckets) {
      if (t - bucket.lastSeenMs >= this.ttlMs) {
        for (const text of bucket.texts) this.talk.unlearn(text);
        this.#buckets.delete(key);
      }
    }
  }

  forgetAll(): void {
    for (const bucket of this.#buckets.values()) {
      for (const text of bucket.texts) this.talk.unlearn(text);
    }
    this.#buckets.clear();
  }
}
