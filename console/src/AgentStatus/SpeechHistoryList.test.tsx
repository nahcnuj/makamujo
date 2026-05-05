/** @jsxImportSource hono/jsx */
import { describe, expect, it } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { SpeechHistoryList } from "./SpeechHistoryList";

const SAMPLE_ITEMS = [
  { id: "speech-3", speechText: "三番目の発話", displayLine: "三番目の発話 (n=4)", nGramLabel: "n=4" },
  { id: "speech-2", speechText: "二番目の発話", displayLine: "二番目の発話 (n=3)", nGramLabel: "n=3" },
  { id: "speech-1", speechText: "最初の発話", displayLine: "最初の発話 (n=4)", nGramLabel: "n=4" },
];

describe("SpeechHistoryList", () => {
  it("renders all initial items", () => {
    const html = renderToString(
      <SpeechHistoryList initialItems={SAMPLE_ITEMS} emphasizeLatest={true} />,
    );

    expect(html).toContain("三番目の発話");
    expect(html).toContain("二番目の発話");
    expect(html).toContain("最初の発話");
  });

  it("renders items in given order (newest first)", () => {
    const html = renderToString(
      <SpeechHistoryList initialItems={SAMPLE_ITEMS} emphasizeLatest={true} />,
    );

    const pos3 = html.indexOf("三番目の発話");
    const pos2 = html.indexOf("二番目の発話");
    const pos1 = html.indexOf("最初の発話");
    expect(pos3).toBeLessThan(pos2);
    expect(pos2).toBeLessThan(pos1);
  });

  it("emphasizes the first item with thicker bottom border when emphasizeLatest is true", () => {
    const html = renderToString(
      <SpeechHistoryList initialItems={SAMPLE_ITEMS} emphasizeLatest={true} />,
    );

    expect(html).toContain("border-b-emerald-300/80");
    expect(html).toContain("border-bottom-width:var(--speech-history-border-bottom-width)");
  });

  it("does not emphasize the first item when emphasizeLatest is false", () => {
    const html = renderToString(
      <SpeechHistoryList initialItems={SAMPLE_ITEMS} emphasizeLatest={false} />,
    );

    expect(html).not.toContain("border-b-emerald-300/80");
    expect(html).not.toContain("border-bottom-width:var(--speech-history-border-bottom-width)");
  });

  it("renders word chips for space-separated speech text", () => {
    const html = renderToString(
      <SpeechHistoryList initialItems={SAMPLE_ITEMS} emphasizeLatest={true} />,
    );

    expect((html.match(/speech-word-chip/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("renders trace nodes as word chips when nodes are present", () => {
    const itemsWithNodes = [
      {
        id: "speech-1",
        speechText: "alpha beta gamma",
        displayLine: "alpha beta gamma (n=4)",
        nGramLabel: "n=4",
        nodes: ["alpha", "beta", "gamma"],
      },
    ];
    const html = renderToString(
      <SpeechHistoryList initialItems={itemsWithNodes} emphasizeLatest={true} />,
    );

    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("gamma");
    expect((html.match(/speech-word-chip/g) ?? []).length).toBe(3);
  });

  it("renders 学習の取り消し button for each item", () => {
    const html = renderToString(
      <SpeechHistoryList initialItems={SAMPLE_ITEMS} emphasizeLatest={true} />,
    );

    expect((html.match(/aria-label="学習の取り消し"/g) ?? []).length).toBe(3);
  });

  it("renders no pending notification initially", () => {
    const html = renderToString(
      <SpeechHistoryList initialItems={SAMPLE_ITEMS} emphasizeLatest={true} />,
    );

    expect(html).not.toContain("新しい発話が");
  });
});
