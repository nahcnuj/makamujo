/** @jsxImportSource hono/jsx */
import { describe, expect, it } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { createAgentStatusRows } from "./createAgentStatusRows";
import { MarkovModelStatusSection } from "./MarkovModelStatusSection";

describe("createAgentStatusRows", () => {
  it("returns readable status rows when niconama metadata exists", () => {
    const rows = createAgentStatusRows({
      niconama: {
        type: "live",
        meta: {
          title: "タイトル",
          url: "https://example.com/live",
          start: 1_700_000_000,
          total: { listeners: 123, comments: 45, gift: 6, ad: 7 },
        },
      },
      currentGame: { name: "ゲームID", state: { status: "idle" } },
      nGram: 4,
      speech: { speech: "テスト発話", silent: false },
      speechHistory: [{ id: "speech-1", speech: "alpha beta gamma", nGram: 4, nGramRaw: 4 }],
    } as any);

    expect(rows).not.toContainEqual({ label: "タイトル", value: "タイトル" });
    expect(rows.find((row) => row.label === "開始時刻")).toBeUndefined();
    expect(rows.find((row) => row.label === "配信URL")).toBeUndefined();
    expect(rows).not.toContainEqual({ label: "現在のゲーム", value: "ゲームID" });
    expect(rows).toContainEqual({ label: "生成N-gram", hideLabel: true, value: "4-gram" });
    expect(rows.find((row) => row.label === "発話内容")?.value).toBe("テスト発話");
  });

  it("hides the speech history label so the value spans full width", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: 4 },
      ],
    } as any);

    const speechHistoryRow = rows.find((row) => row.label === "これまでの発話");
    expect(speechHistoryRow).toEqual(expect.objectContaining({ hideLabel: true }));
  });

  it("renders speech history words as separate cards", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: 4 },
      ],
    } as any);
    const markovRows = rows.filter((r) => r.label === "これまでの発話" || r.label === "生成N-gram");
    const html = renderToString(<MarkovModelStatusSection markovModelRows={markovRows} />);

    expect(html).toContain("これまでの発話");
    expect((html.match(/speech-word-chip/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("n=4");
    expect(html).toContain("class=\"text-xs whitespace-nowrap\"");
    expect(html).toContain("bg-emerald-950/40");
  });

  it("renders speech word chips with the same background class regardless of emphasis", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: 4, nGramRaw: 4 },
        { id: "speech-2", speech: "ぜひ遊びに来てね", nGram: 3, nGramRaw: 3 },
      ],
    } as any);
    const markovRows = rows.filter((r) => r.label === "これまでの発話" || r.label === "生成N-gram");
    const html = renderToString(<MarkovModelStatusSection markovModelRows={markovRows} />);
    const chipClassAttributes = html.match(/class="speech-word-chip[^"]*"/g) ?? [];

    expect(chipClassAttributes.length).toBeGreaterThanOrEqual(2);
    chipClassAttributes.forEach((classAttr) => {
      expect(classAttr).toContain("bg-emerald-950/40");
    });
    expect(html).toContain("items-baseline");
  });

  it("hides duplicate speech content from live delivery when it matches top speech history", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speech: { speech: "alpha beta gamma", silent: false },
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: 4, nGramRaw: 4 },
      ],
    } as any);

    expect(rows.find((row) => row.label === "発話内容")).toBeUndefined();
    expect(rows.find((row) => row.label === "これまでの発話")).toBeDefined();
  });

  it("keeps first history emphasis even when current speech is absent", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: 4, nGramRaw: 4 },
      ],
    } as any);
    const markovRows = rows.filter((r) => r.label === "これまでの発話" || r.label === "生成N-gram");
    const html = renderToString(<MarkovModelStatusSection markovModelRows={markovRows} />);

    expect(html).toContain("border-b-emerald-300/80");
    expect(html).toContain("border-bottom-width:var(--speech-history-border-bottom-width)");
    expect(html).not.toContain("bg-emerald-300/80");
    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("gamma");
  });

  it("still renders speech content when it differs from top speech history", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speech: { speech: "コメント", silent: false },
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: 4, nGramRaw: 4 },
      ],
    } as any);

    expect(rows.find((row) => row.label === "発話内容")?.value).toBe("コメント");
    expect(rows.find((row) => row.label === "これまでの発話")).toBeDefined();
  });

  it("emphasizes the first speech history item with a thicker bottom border", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: 4, nGramRaw: 4 },
      ],
    } as any);
    const markovRows = rows.filter((r) => r.label === "これまでの発話" || r.label === "生成N-gram");
    const html = renderToString(<MarkovModelStatusSection markovModelRows={markovRows} />);

    expect(html).toContain("border-b");
    expect(html).toContain("border-b-emerald-300/80");
    expect(html).toContain("border-bottom-width:var(--speech-history-border-bottom-width)");
    expect(html).toContain("border-emerald-300/30");
  });

  it("normalizes object speech payloads for top-level speech", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speech: { speech: { text: "コメント", nodes: ["コメント"] }, silent: false },
    } as any);

    expect(rows.find((row) => row.label === "発話内容")?.value).toBe("コメント");
  });

  it("normalizes object speech payloads in speech history", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [
        { id: "speech-1", speech: { text: "コメント", nodes: ["コメント"] }, nGram: 4, nGramRaw: 4 },
      ],
    } as any);
    const markovRows = rows.filter((r) => r.label === "これまでの発話" || r.label === "生成N-gram");
    const html = renderToString(<MarkovModelStatusSection markovModelRows={markovRows} />);

    expect(html).toContain("コメント");
    expect((html.match(/speech-word-chip/g) || []).length).toBe(1);
  });

  it("renders markov trace nodes when available", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: 4, nodes: ["alpha", "beta", "gamma"] },
      ],
    } as any);
    const markovRows = rows.filter((r) => r.label === "これまでの発話" || r.label === "生成N-gram");
    const html = renderToString(<MarkovModelStatusSection markovModelRows={markovRows} />);

    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("gamma");
    expect((html.match(/speech-word-chip/g) || []).length).toBe(3);
  });

  it("renders reply target comment as standalone row when no speech history", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      replyTargetComment: {
        text: "このコメントに返信します",
        pickedTopic: "返信",
      },
    } as any);
    const replyRow = rows.find((row) => row.label === "返信先コメント");

    expect(replyRow).toBeDefined();
    expect(replyRow?.hideLabel).toBeFalsy();
    const html = renderToString(<MarkovModelStatusSection markovModelRows={[replyRow!] as any} />);

    expect(html).toContain("返信先コメント");
    expect(html).toContain("このコメントに");
    expect(html).toContain("します");
    expect(html).toContain("返信");
    expect(html).toContain("bg-emerald-300/30");
  });

  it("does not render a standalone reply row when speech history exists", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: 4, nodes: ["alpha", "beta", "gamma"] },
      ],
      replyTargetComment: {
        text: "このコメントに返信します",
        pickedTopic: "返信",
      },
    } as any);

    const replyRow = rows.find((row) => row.label === "返信先コメント");
    const speechHistoryRow = rows.find((row) => row.label === "これまでの発話");
    expect(replyRow).toBeUndefined();
    expect(speechHistoryRow).toBeDefined();
  });

  it("renders trace nodes even when nGram is invalid", () => {
    const rows = createAgentStatusRows({
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: NaN, nodes: ["alpha", "beta", "gamma"] },
      ],
    } as any);
    const speechHistoryRow = rows.find((row) => row.label === "これまでの発話");
    expect(speechHistoryRow?.value).toBeUndefined();
    const html = renderToString(<MarkovModelStatusSection markovModelRows={[speechHistoryRow!] as any} />);

    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("gamma");
    expect((html.match(/speech-word-chip/g) || []).length).toBe(3);
  });

  it("does not show detailed game state rows when currentGame is null", () => {
    const rows = createAgentStatusRows({ currentGame: null });
    expect(rows.find((row) => row.label === "ゲーム情報")).toBeUndefined();
  });
});
