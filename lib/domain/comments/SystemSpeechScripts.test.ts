import { describe, expect, it } from "bun:test";
import {
  CRUISE_QUOTE_START_COMMENT,
  CRUISE_WELCOME_SPEECHES,
  extractAdName,
  formatAdThanks,
  formatGiftThanks,
  isAdCompletedComment,
  isCruiseQuoteStart,
  STREAM_END_SPEECHES,
} from "./SystemSpeechScripts";

describe("SystemSpeechScripts", () => {
  it("matches cruise quote start exactly", () => {
    expect(isCruiseQuoteStart(CRUISE_QUOTE_START_COMMENT)).toBe(true);
    expect(isCruiseQuoteStart(CRUISE_QUOTE_START_COMMENT + " ")).toBe(false);
  });

  it("detects ad completed comments", () => {
    expect(isAdCompletedComment("【広告】太郎さんが広告しました")).toBe(true);
    expect(extractAdName("【広告】太郎さんが広告しました")).toBe("太郎");
    expect(formatAdThanks("太郎")).toBe("太郎さん、広告ありがとうございます！");
  });

  it("formats gift thanks with anonymity branch", () => {
    expect(formatGiftThanks(undefined, true)).toBe("ギフトありがとうございます！");
    expect(formatGiftThanks("花子", false)).toBe("花子さん、ギフトありがとうございます！");
  });

  it("exposes fixed-length cruise and end scripts", () => {
    expect(CRUISE_WELCOME_SPEECHES).toHaveLength(4);
    expect(STREAM_END_SPEECHES).toHaveLength(4);
  });
});
