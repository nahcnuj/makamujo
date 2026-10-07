import { describe, expect, it } from "bun:test";
import {
  parseDisplayedStatistics,
  retainDefinedStatistics,
} from "./watchPageStatistics";

/** 視聴者数だけを読んで、1 指標の読み取りを観察する。 */
const parseViewers = (text: string | null | undefined) =>
  parseDisplayedStatistics({
    viewers: text,
    comments: undefined,
    nicoadPoints: undefined,
    giftPoints: undefined,
  }).viewers;

describe("watch page statistics", () => {
  it("reads plain digits", () => {
    expect(parseViewers("25")).toBe(25);
    expect(parseViewers(" 0 ")).toBe(0);
  });

  it("reads digits with thousands separators", () => {
    expect(parseViewers("1,234")).toBe(1234);
    expect(parseViewers("12,345,678")).toBe(12_345_678);
  });

  it("reads Japanese magnitude suffixes", () => {
    expect(parseViewers("1.2万")).toBe(12_000);
    expect(parseViewers("12万")).toBe(120_000);
    expect(parseViewers("1.5億")).toBe(150_000_000);
    expect(parseViewers("2兆")).toBe(2e12);
  });

  it("treats the placeholder and blanks as no value", () => {
    expect(parseViewers("-")).toBeUndefined();
    expect(parseViewers("")).toBeUndefined();
    expect(parseViewers("   ")).toBeUndefined();
    expect(parseViewers(null)).toBeUndefined();
    expect(parseViewers(undefined)).toBeUndefined();
  });

  it("rejects text that is not a number", () => {
    expect(parseViewers("不明")).toBeUndefined();
    expect(parseViewers("1,2a")).toBeUndefined();
    expect(parseViewers("12 34")).toBeUndefined();
  });

  it("numericates every metric the statistics row shows", () => {
    expect(
      parseDisplayedStatistics({
        viewers: "25",
        comments: "1,055",
        nicoadPoints: "12.3万",
        giftPoints: "8",
      }),
    ).toEqual({
      viewers: 25,
      comments: 1055,
      nicoadPoints: 123_000,
      giftPoints: 8,
    });
  });

  it("keeps metrics the page shows as a placeholder as no value", () => {
    const statistics = parseDisplayedStatistics({
      viewers: "25",
      comments: "-",
      nicoadPoints: "-",
      giftPoints: "-",
    });

    expect(statistics.viewers).toBe(25);
    expect(statistics.comments).toBeUndefined();
    expect(statistics.nicoadPoints).toBeUndefined();
    expect(statistics.giftPoints).toBeUndefined();
  });

  it("has no value at all when every metric is a placeholder", () => {
    const statistics = parseDisplayedStatistics({
      viewers: "-",
      comments: "-",
      nicoadPoints: "-",
      giftPoints: "-",
    });

    expect(statistics).toEqual({
      viewers: undefined,
      comments: undefined,
      nicoadPoints: undefined,
      giftPoints: undefined,
    });
  });
});

describe("retainDefinedStatistics", () => {
  it("keeps a previously collected metric when the new reading is blank", () => {
    expect(
      retainDefinedStatistics(
        { viewers: 10, comments: 4, nicoadPoints: 2, giftPoints: 3 },
        {
          viewers: undefined,
          comments: 8,
          nicoadPoints: undefined,
          giftPoints: undefined,
        },
      ),
    ).toEqual({
      viewers: 10,
      comments: 8,
      nicoadPoints: 2,
      giftPoints: 3,
    });
  });
});
