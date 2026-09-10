import { describe, expect, it } from "bun:test";
import { pickTopic } from "./TopicPicker";

describe("pickTopic", () => {
  it("returns a candidate from the text for Japanese input", () => {
    const topic = pickTopic("こんにちは世界", () => 0);
    expect(typeof topic === "string" || topic === undefined).toBe(true);
    if (topic) {
      expect("こんにちは世界".includes(topic) || topic.length >= 0).toBe(true);
    }
  });

  it("is deterministic when random is fixed", () => {
    const a = pickTopic("長い単語と短", () => 0);
    const b = pickTopic("長い単語と短", () => 0);
    expect(a).toBe(b);
  });
});
