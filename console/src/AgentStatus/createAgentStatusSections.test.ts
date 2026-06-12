import { describe, expect, it } from "bun:test";
import { createAgentStatusSections } from "./createAgentStatusSections";
import type { AgentStateResponse } from "./types";

describe("createAgentStatusSections", () => {
  it("categorizes rows into delivery, markov-model, and game sections", () => {
    const sections = createAgentStatusSections({
      niconama: {
        type: "live",
        meta: { title: "タイトル", url: "https://example.com" },
      },
      currentGame: { name: "ゲームID", state: { status: "running" } },
      nGram: 4,
      speechHistory: [{ id: "speech-1", speech: "hello world", nGram: 2 }],
    } as unknown as AgentStateResponse);

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
    } as unknown as AgentStateResponse);

    expect(sections.map((section) => section.title)).toEqual([
      "マルコフ連鎖モデル",
      "『-』プレイ中",
    ]);
  });

  it("includes reply target comments in the markov model section", () => {
    const sections = createAgentStatusSections({
      nGram: 4,
      replyTargetComment: {
        text: "返信先コメントを表示します",
        pickedTopic: "返信",
      },
    } as unknown as AgentStateResponse);

    const markovSection = sections.find(
      (section) => section.title === "マルコフ連鎖モデル",
    );
    expect(markovSection?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "返信先コメント" }),
      ]),
    );
  });

  it("includes recent comments in the delivery section", () => {
    const sections = createAgentStatusSections({
      recentComments: [
        { data: { no: 1, comment: "こんにちは" } },
        { data: { no: 2, comment: "テストコメント" } },
      ],
    } as unknown as AgentStateResponse);

    const deliverySection = sections.find(
      (section) => section.title === "配信状況",
    );
    expect(deliverySection?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "最近のコメント" }),
      ]),
    );
  });

  it("shows fallback game title without detail rows when currentGame is null", () => {
    const sections = createAgentStatusSections({
      currentGame: null,
    } as unknown as AgentStateResponse);

    expect(sections).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: test data guaranteed to have sections
    const gameSection = sections[0]!;
    expect(gameSection.title).toBe("『-』プレイ中");
    expect(gameSection.rows).toEqual([]);
  });

  it("shows fallback game title without detail rows when currentGame is missing", () => {
    const sections = createAgentStatusSections(
      {} as unknown as AgentStateResponse,
    );

    expect(sections).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: test data guaranteed to have sections
    const gameSection = sections[0]!;
    expect(gameSection.title).toBe("『-』プレイ中");
    expect(gameSection.rows).toEqual([]);
  });
});
