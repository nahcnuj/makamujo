import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
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
    expect(rows).toContainEqual({ label: "現在のゲーム", value: "ゲームID" });
    expect(rows).toContainEqual({ label: "生成N-gram", value: "4-gram" });
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
    const html = renderToStaticMarkup(<MarkovModelStatusSection markovModelRows={markovRows} />);

    expect(html).toContain("これまでの発話");
    expect((html.match(/speech-word-chip/g) || []).length).toBeGreaterThanOrEqual(3);
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
    const html = renderToStaticMarkup(<MarkovModelStatusSection markovModelRows={markovRows} />);

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
    const html = renderToStaticMarkup(<MarkovModelStatusSection markovModelRows={markovRows} />);

    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("gamma");
    expect((html.match(/speech-word-chip/g) || []).length).toBe(3);
  });

  it("renders trace nodes even when nGram is invalid", () => {
    const rows = createAgentStatusRows({
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: NaN, nodes: ["alpha", "beta", "gamma"] },
      ],
    } as any);
    const speechHistoryRow = rows.find((row) => row.label === "これまでの発話");
    expect(speechHistoryRow?.value).toBeUndefined();
    const html = renderToStaticMarkup(<MarkovModelStatusSection markovModelRows={[speechHistoryRow!] as any} />);

    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("gamma");
    expect((html.match(/speech-word-chip/g) || []).length).toBe(3);
  });
});
