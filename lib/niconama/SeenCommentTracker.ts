/**
 * ニコ生コメント閲覧済み管理
 *
 * 長時間稼働時にメモリが無限増大しないよう、一定件数を超えたら古いものから削除する。
 */
export class SeenCommentTracker {
  readonly #seen: Set<string>;
  readonly #maxSize: number;

  /**
   * @param maxSize 保持する最大件数。超えた場合は古い順に削除される。
   */
  constructor(maxSize = 50_000) {
    this.#seen = new Set<string>();
    this.#maxSize = maxSize;
  }

  get set(): Set<string> {
    return this.#seen;
  }

  has(identifier: string): boolean {
    return this.#seen.has(identifier);
  }

  add(identifier: string): void {
    this.#seen.add(identifier);
  }

  get size(): number {
    return this.#seen.size;
  }

  /**
   * サイズが上限を超えた場合、最も古いエントリを削除して上限以内に収める。
   */
  trimIfNeeded(): void {
    if (this.#seen.size <= this.#maxSize) return;

    const removeCount = this.#seen.size - this.#maxSize;
    let removed = 0;
    for (const id of this.#seen) {
      this.#seen.delete(id);
      removed += 1;
      if (removed >= removeCount) break;
    }
  }
}
