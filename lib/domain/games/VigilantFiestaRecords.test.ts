import { describe, expect, it } from "bun:test";
import {
  buildSlotKey,
  emptyScoreRecords,
  emptyStoredHighscores,
  mergeRecordsIntoStored,
  parseStoredAllTimeBest,
  parseStoredHighscores,
  pruneSlots,
  recordsForSlot,
  serializeAllTimeBest,
  serializeStoredHighscores,
  updateScoreRecords,
} from "./VigilantFiestaRecords";

describe("VigilantFiestaRecords", () => {
  it("starts empty", () => {
    expect(emptyScoreRecords()).toEqual({ sessionBest: 0, allTimeBest: 0 });
  });

  it("raises session and all-time together", () => {
    const next = updateScoreRecords({ sessionBest: 10, allTimeBest: 100 }, 150);
    expect(next).toEqual({ sessionBest: 150, allTimeBest: 150 });
  });

  it("raises only session when below all-time", () => {
    const next = updateScoreRecords({ sessionBest: 10, allTimeBest: 1000 }, 50);
    expect(next).toEqual({ sessionBest: 50, allTimeBest: 1000 });
  });

  it("ignores non-finite scores", () => {
    const base = { sessionBest: 3, allTimeBest: 9 };
    expect(updateScoreRecords(base, Number.NaN)).toBe(base);
    expect(updateScoreRecords(base, -1)).toBe(base);
  });

  it("round-trips all-time JSON (legacy helper)", () => {
    expect(parseStoredAllTimeBest(serializeAllTimeBest(42))).toBe(42);
    expect(parseStoredAllTimeBest("not-json")).toBe(0);
  });

  it("builds slot key from program url only (lv…)", () => {
    expect(
      buildSlotKey({
        url: "https://live.nicovideo.jp/watch/lv123456789",
        start: 1_700_000_000_000,
      }),
    ).toBe("https://live.nicovideo.jp/watch/lv123456789");
    expect(buildSlotKey({ url: "  ", start: 1 })).toBeUndefined();
    expect(buildSlotKey({ url: undefined })).toBeUndefined();
  });

  it("loads slot best for the same 枠 after parse", () => {
    const key = buildSlotKey({ url: "https://live.example/watch/lv1" })!;
    const stored = mergeRecordsIntoStored(
      emptyStoredHighscores(),
      { sessionBest: 77, allTimeBest: 200 },
      key,
      1_000,
    );
    const raw = serializeStoredHighscores(stored, key);
    const loaded = parseStoredHighscores(raw);
    expect(recordsForSlot(loaded, key)).toEqual({
      sessionBest: 77,
      allTimeBest: 200,
    });
    expect(recordsForSlot(loaded, "https://live.example/watch/lv2")).toEqual({
      sessionBest: 0,
      allTimeBest: 200,
    });
  });

  it("prunes old slots but keeps the active key", () => {
    const slots: Record<string, { sessionBest: number; updatedAt: number }> =
      {};
    for (let i = 0; i < 40; i++) {
      slots[`u#${i}`] = { sessionBest: i, updatedAt: i };
    }
    const pruned = pruneSlots(slots, 5, "u#0");
    expect(Object.keys(pruned).length).toBeLessThanOrEqual(5);
    expect(pruned["u#0"]?.sessionBest).toBe(0);
  });
});
