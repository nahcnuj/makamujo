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
      "マルコフ連鎖モデルの状態",
      "ゲームの状態",
    ]);
  });

  it("returns only sections that have rows", () => {
    const sections = createAgentStatusSections({
      nGram: 4,
      speechHistory: [{ id: "speech-1", speech: "hello world", nGram: 2 }],
    } as any);

    expect(sections.map((section) => section.title)).toEqual(["マルコフ連鎖モデルの状態"]);
  });
});
