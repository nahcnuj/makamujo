import { describe, expect, it } from "bun:test";
import { shouldInvokeTts, trimmedSpeechText } from "./emptySpeech";

describe("emptySpeech", () => {
  it("skips TTS for empty and whitespace", () => {
    expect(shouldInvokeTts("")).toBe(false);
    expect(shouldInvokeTts("   ")).toBe(false);
    expect(shouldInvokeTts("こんにちは")).toBe(true);
  });

  it("trims for TTS payload", () => {
    expect(trimmedSpeechText("  a  ")).toBe("a");
  });
});
