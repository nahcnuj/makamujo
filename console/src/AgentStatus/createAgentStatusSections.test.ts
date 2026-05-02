import { describe, expect, it } from "bun:test";
import { createAgentStatusSections } from "./createAgentStatusSections";

describe("createAgentStatusSections", () => {
  it("categorizes rows into delivery, markov-model, and game sections", () => {
    const sections = createAgentStatusSections({
      niconama: { type: "live", meta: { title: "タイトル", url: "https://example.com" } },
      currentGame: { name: "ゲームID", state: { status: "running" } },
      nGram: 4,
      speechHistory: [{ id: "speech-1", speech: "hello world", nGram: 2 }],
    } as any);

    expect(sections.map((section) => section.title)).toEqual([
      "配信状況",
      "マルコフ連鎖モデル",
      "『ゲームID』プレイ中",
    ]);
  });

  it("returns only sections that have rows plus fallback game section", () => {
    const sections = createAgentStatusSections({
      nGram: 4,
      speechHistory: [{ id: "speech-1", speech: "hello world", nGram: 2 }],
    } as any);

    expect(sections.map((section) => section.title)).toEqual(["マルコフ連鎖モデル", "『-』プレイ中"]);
  });

  it("shows fallback game title without detail rows when currentGame is null", () => {
    const sections = createAgentStatusSections({ currentGame: null } as any);

    expect(sections).toHaveLength(1);
    const gameSection = sections[0]!;
    expect(gameSection.title).toBe("『-』プレイ中");
    expect(gameSection.rows).toEqual([]);
  });

  it("shows fallback game title without detail rows when currentGame is missing", () => {
    const sections = createAgentStatusSections({} as any);

    expect(sections).toHaveLength(1);
    const gameSection = sections[0]!;
    expect(gameSection.title).toBe("『-』プレイ中");
    expect(gameSection.rows).toEqual([]);
  });
});
