/** @jsxImportSource hono/jsx */
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { render } from "hono/jsx/dom";
import { JSDOM } from "jsdom";
import { SpeechHistoryList, SpeechHistoryListItem } from "./SpeechHistoryList";

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>");
  globalThis.window = dom.window as any;
  globalThis.document = dom.window.document as any;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle);
});

afterAll(() => {
  dom.window.close();
  delete (globalThis as any).window;
  delete (globalThis as any).document;
});

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

  it("renders reply annotation inline inside the first item when speechHistoryItem contains a replyTargetComment", () => {
    const localContainer = document.createElement("div");
    render(
      <SpeechHistoryListItem
        speechHistoryItem={{
          id: "speech-1",
          speechText: "三番目の発話",
          displayLine: "三番目の発話 (n=4)",
          nGramLabel: "n=4",
          replyTargetComment: { text: "おめでとうございます", pickedTopic: "おめでとう" },
        }}
        isFirst
        emphasizeLatest
      />,
      localContainer,
    );

    const replySpan = localContainer.querySelector("span.text-xs");
    expect(replySpan).not.toBeNull();
    expect(replySpan?.textContent).toContain("おめでとう");
    expect(replySpan?.textContent).toContain("ございます");
  });

  it("attaches fallback reply annotation to the matching speech history item by pickedTopic", () => {
    const items = [
      {
        id: "speech-1",
        speechText: "わこつ",
        displayLine: "わこつ (n=4)",
        nGramLabel: "n=4",
        nodes: ["わこつ"],
      },
      {
        id: "speech-2",
        speechText: "ここんにちは",
        displayLine: "ここんにちは (n=4)",
        nGramLabel: "n=4",
        nodes: ["ここんにちは"],
      },
    ];
    const localContainer = document.createElement("div");
    render(
      <SpeechHistoryList
        initialItems={items}
        emphasizeLatest={true}
        replyTargetComment={{ text: "このコメントに返信します", pickedTopic: "こ" }}
      />,
      localContainer,
    );

    const replySpans = Array.from(localContainer.querySelectorAll("span.text-xs")).filter(
      (span) => span.className.includes("text-emerald-300"),
    );
    expect(replySpans.length).toBe(1);
    const firstItemReply = localContainer.querySelector("li:nth-child(1) span[class*='text-emerald-300']");
    const secondItemReply = localContainer.querySelector("li:nth-child(2) span[class*='text-emerald-300']");
    expect(firstItemReply).toBeNull();
    expect(secondItemReply).not.toBeNull();
    expect(secondItemReply?.textContent).toContain("このコメントに返信します");
  });

  it("renders reply annotations for each speech history item when each item has its own replyTargetComment", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: `speech-${10 - index}`,
      speechText: `speech-${10 - index}`,
      displayLine: `speech-${10 - index} (n=4)`,
      nGramLabel: "n=4",
      nodes: [`speech-${10 - index}`],
      replyTargetComment: {
        text: `comment-${10 - index}-reply`,
        pickedTopic: "reply",
      },
    }));

    items.forEach((item) => {
      const localContainer = document.createElement("div");
      render(
        <SpeechHistoryListItem
          speechHistoryItem={item}
          isFirst={false}
          emphasizeLatest={true}
        />,
        localContainer,
      );

      const replySpan = localContainer.querySelector("span.text-xs");
      expect(replySpan).not.toBeNull();
      expect(replySpan?.textContent).toContain(item.replyTargetComment?.text ?? "");
    });
  });

  it("does not render reply annotation on non-first items", () => {
    const items = [
      { id: "speech-2", speechText: "secondSpeech", displayLine: "secondSpeech (n=4)", nGramLabel: "n=4", nodes: ["secondSpeech"] },
      { id: "speech-1", speechText: "firstSpeech", displayLine: "firstSpeech (n=4)", nGramLabel: "n=4", nodes: ["firstSpeech"] },
    ];
    const html = renderToString(
      <SpeechHistoryList
        initialItems={items}
        emphasizeLatest={true}
        replyTargetComment={{ text: "replyComment", pickedTopic: undefined }}
      />,
    );

    // reply annotation appears only once, before the first item's word chips
    const replyPos = html.indexOf("replyComment");
    const secondSpeechPos = html.indexOf("secondSpeech");
    const firstSpeechPos = html.indexOf("firstSpeech");
    expect(replyPos).toBeGreaterThanOrEqual(0);
    expect(replyPos).toBeLessThan(secondSpeechPos);
    expect(secondSpeechPos).toBeLessThan(firstSpeechPos);
  });

  it("does not render reply annotation when replyTargetComment is not provided", () => {
    const html = renderToString(
      <SpeechHistoryList initialItems={SAMPLE_ITEMS} emphasizeLatest={true} />,
    );

    expect(html).not.toContain("返信先:");
  });
});
