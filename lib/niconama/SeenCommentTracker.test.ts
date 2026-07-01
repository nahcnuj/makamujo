import { describe, expect, it } from "bun:test";
import { SeenCommentTracker } from "./SeenCommentTracker";

describe("SeenCommentTracker", () => {
  it("新規IDを追加してhasで確認できる", () => {
    const tracker = new SeenCommentTracker();
    tracker.add("id1");
    expect(tracker.has("id1")).toBe(true);
    expect(tracker.has("id2")).toBe(false);
  });

  it("sizeが正しい件数を返す", () => {
    const tracker = new SeenCommentTracker();
    expect(tracker.size).toBe(0);
    tracker.add("a");
    tracker.add("b");
    expect(tracker.size).toBe(2);
  });

  it("setプロパティで内部Setを参照できる", () => {
    const tracker = new SeenCommentTracker();
    tracker.add("x");
    expect(tracker.set.has("x")).toBe(true);
  });

  it("maxSizeを超えたらtrimIfNeededで古いエントリが削除される", () => {
    const tracker = new SeenCommentTracker(3);
    tracker.add("a");
    tracker.add("b");
    tracker.add("c");
    tracker.add("d"); // maxSize超過

    // trimIfNeededを呼ぶ前はまだ4件
    expect(tracker.size).toBe(4);

    tracker.trimIfNeeded();

    // maxSize(3)以内に収まる
    expect(tracker.size).toBe(3);
    // 最古の"a"が削除される
    expect(tracker.has("a")).toBe(false);
    // 新しい方は残る
    expect(tracker.has("d")).toBe(true);
  });

  it("maxSize以内ではtrimIfNeededで削除されない", () => {
    const tracker = new SeenCommentTracker(5);
    tracker.add("a");
    tracker.add("b");

    tracker.trimIfNeeded();

    expect(tracker.size).toBe(2);
    expect(tracker.has("a")).toBe(true);
    expect(tracker.has("b")).toBe(true);
  });

  it("同じIDを複数回addしても重複しない", () => {
    const tracker = new SeenCommentTracker();
    tracker.add("dup");
    tracker.add("dup");
    expect(tracker.size).toBe(1);
  });
});
