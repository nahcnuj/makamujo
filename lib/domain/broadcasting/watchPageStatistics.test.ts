import { describe, expect, it } from "bun:test";
import {
  parseDisplayedMetric,
  parseDisplayedStatistics,
} from "./watchPageStatistics";

describe("parseDisplayedMetric", () => {
  it("reads plain digits", () => {
    expect(parseDisplayedMetric("25")).toBe(25);
    expect(parseDisplayedMetric(" 0 ")).toBe(0);
  });

  it("reads digits with thousands separators", () => {
    expect(parseDisplayedMetric("1,234")).toBe(1234);
    expect(parseDisplayedMetric("12,345,678")).toBe(12_345_678);
  });

  it("reads Japanese magnitude suffixes", () => {
    expect(parseDisplayedMetric("1.2万")).toBe(12_000);
    expect(parseDisplayedMetric("12万")).toBe(120_000);
    expect(parseDisplayedMetric("1.5億")).toBe(150_000_000);
    expect(parseDisplayedMetric("2兆")).toBe(2e12);
  });

  it("treats the placeholder and blanks as no value", () => {
    expect(parseDisplayedMetric("-")).toBeUndefined();
    expect(parseDisplayedMetric("")).toBeUndefined();
    expect(parseDisplayedMetric("   ")).toBeUndefined();
    expect(parseDisplayedMetric(null)).toBeUndefined();
    expect(parseDisplayedMetric(undefined)).toBeUndefined();
  });

  it("rejects text that is not a number", () => {
    expect(parseDisplayedMetric("不明")).toBeUndefined();
    expect(parseDisplayedMetric("1,2a")).toBeUndefined();
    expect(parseDisplayedMetric("12 34")).toBeUndefined();
  });
});

describe("parseDisplayedStatistics", () => {
  it("numericates every metric the statistics row shows", () => {
    expect(
      parseDisplayedStatistics({
        viewers: "25",
        comments: "1,055",
        nicoadPoints: "12.3万",
        giftPoints: "8",
        timeshiftReservations: "4",
      }),
    ).toEqual({
      viewers: 25,
      comments: 1055,
      nicoadPoints: 123_000,
      giftPoints: 8,
      timeshiftReservations: 4,
    });
  });

  it("omits metrics the page shows as a placeholder", () => {
    const statistics = parseDisplayedStatistics({
      viewers: "25",
      comments: "-",
      nicoadPoints: "-",
      giftPoints: "-",
    });

    expect(statistics).toEqual({ viewers: 25 });
    expect("comments" in statistics).toBe(false);
    expect("nicoadPoints" in statistics).toBe(false);
    expect("giftPoints" in statistics).toBe(false);
  });

  it("omits the optional timeshift metric when it was not collected", () => {
    const statistics = parseDisplayedStatistics({
      viewers: "1",
      comments: "2",
      nicoadPoints: "3",
      giftPoints: "4",
    });

    expect("timeshiftReservations" in statistics).toBe(false);
  });

  it("returns an empty object when every metric is a placeholder", () => {
    expect(
      parseDisplayedStatistics({
        viewers: "-",
        comments: "-",
        nicoadPoints: "-",
        giftPoints: "-",
      }),
    ).toEqual({});
  });
});
