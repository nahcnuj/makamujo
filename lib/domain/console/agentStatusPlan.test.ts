import { describe, expect, it } from "bun:test";
import {
  formatNGramValue,
  formatStateLabel,
  normalizeSpeechText,
  planAgentStatusRows,
  SPEECH_UNAVAILABLE_INDICATOR,
} from "./agentStatusPlan";

describe("normalizeSpeechText", () => {
  it("trims strings and nested text/speech fields", () => {
    expect(normalizeSpeechText("  hi  ")).toBe("hi");
    expect(normalizeSpeechText({ text: "a" })).toBe("a");
    expect(normalizeSpeechText({ speech: "b" })).toBe("b");
    expect(normalizeSpeechText({ speech: { text: "c" } })).toBe("c");
    expect(normalizeSpeechText("   ")).toBeUndefined();
  });
});

describe("formatNGramValue", () => {
  it("matches console display rules", () => {
    expect(formatNGramValue(undefined, 2)).toBe("-");
    expect(formatNGramValue(2, undefined)).toBe("2-gram");
    expect(formatNGramValue(2, 2.1)).toBe("2-gram (2.10)");
  });
});

describe("formatStateLabel", () => {
  it("maps live/offline", () => {
    expect(formatStateLabel("live")).toBe("配信中");
    expect(formatStateLabel("offline")).toBe("停止中");
    expect(formatStateLabel(undefined)).toBe("-");
  });
});

describe("planAgentStatusRows", () => {
  it("includes live metrics when niconama is non-empty", () => {
    const plans = planAgentStatusRows({
      niconama: { type: "live" },
      hasCurrentGameKey: false,
    });
    expect(plans.some((p) => p.kind === "liveMetrics")).toBe(true);
  });

  it("shows speech unavailable when canSpeak is false and not silent", () => {
    const plans = planAgentStatusRows({
      niconama: {},
      hasCurrentGameKey: false,
      canSpeak: false,
      speech: { speech: "x", silent: false },
    });
    expect(plans).toContainEqual({ kind: "speechUnavailable" });
  });

  it("omits speech content when silent", () => {
    const plans = planAgentStatusRows({
      hasCurrentGameKey: false,
      canSpeak: true,
      speech: { speech: "hello", silent: true },
    });
    expect(plans.some((p) => p.kind === "speechContent" || p.kind === "speechUnavailable")).toBe(false);
  });

  it("prefers speech history over standalone reply target when history is displayable", () => {
    const plans = planAgentStatusRows({
      hasCurrentGameKey: false,
      speechHistory: [{ speech: "past", nGram: 2 }],
      replyTargetComment: { text: "reply", pickedTopic: "r" },
    });
    expect(plans.some((p) => p.kind === "speechHistory")).toBe(true);
    expect(plans.some((p) => p.kind === "replyTargetOnly")).toBe(false);
  });

  it("falls back to reply target when history items lack nGram/nodes", () => {
    const plans = planAgentStatusRows({
      hasCurrentGameKey: false,
      speechHistory: [{ speech: "past" }],
      replyTargetComment: { text: "reply", pickedTopic: "r" },
    });
    expect(plans.some((p) => p.kind === "speechHistory")).toBe(false);
    expect(plans.some((p) => p.kind === "replyTargetOnly")).toBe(true);
  });

  it("exposes the speech unavailable indicator constant used by UI", () => {
    expect(SPEECH_UNAVAILABLE_INDICATOR).toBe("（コメントしてね）");
  });
});
