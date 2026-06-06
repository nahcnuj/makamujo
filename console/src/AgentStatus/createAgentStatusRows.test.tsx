/** @jsxImportSource hono/jsx */
import { describe, expect, it } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { createReplyTargetCommentValueComponent } from "./agentStatusUtils";
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
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: 4, nGramRaw: 4 },
      ],
    } as any);

    expect(rows).not.toContainEqual({ label: "タイトル", value: "タイトル" });
    expect(rows.find((row) => row.label === "開始時刻")).toBeUndefined();
    expect(rows.find((row) => row.label === "配信URL")).toBeUndefined();
    expect(rows).not.toContainEqual({
      label: "現在のゲーム",
      value: "ゲームID",
    });
    expect(rows).toContainEqual({
      label: "生成N-gram",
      hideLabel: true,
      value: "4-gram",
    });
    expect(rows.find((row) => row.label === "発話内容")?.value).toBe(
      "テスト発話",
    );
  });

  it("hides the speech history label so the value spans full width", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [{ id: "speech-1", speech: "alpha beta gamma", nGram: 4 }],
    } as any);

    const speechHistoryRow = rows.find((row) => row.label === "これまでの発話");
    expect(speechHistoryRow).toEqual(
      expect.objectContaining({ hideLabel: true }),
    );
  });

  it("renders speech history words as separate cards", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [{ id: "speech-1", speech: "alpha beta gamma", nGram: 4 }],
    } as any);
    const markovRows = rows.filter(
      (r) => r.label === "これまでの発話" || r.label === "生成N-gram",
    );
    const html = renderToString(
      <MarkovModelStatusSection markovModelRows={markovRows} />,
    );

    expect(html).toContain("これまでの発話");
    expect(
      (html.match(/speech-word-chip/g) || []).length,
    ).toBeGreaterThanOrEqual(3);
    expect(html).toContain("n=4");
    expect(html).toContain('class="text-xs whitespace-nowrap"');
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
    const markovRows = rows.filter(
      (r) => r.label === "これまでの発話" || r.label === "生成N-gram",
    );
    const html = renderToString(
      <MarkovModelStatusSection markovModelRows={markovRows} />,
    );
    const chipClassAttributes =
      html.match(/class="speech-word-chip[^"]*"/g) ?? [];

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
    const markovRows = rows.filter(
      (r) => r.label === "これまでの発話" || r.label === "生成N-gram",
    );
    const html = renderToString(
      <MarkovModelStatusSection markovModelRows={markovRows} />,
    );

    expect(html).toContain("border-b-emerald-300/80");
    expect(html).toContain(
      "border-bottom-width:var(--speech-history-border-bottom-width)",
    );
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

    expect(rows.find((row) => row.label === "発話内容")?.value).toBe(
      "コメント",
    );
    expect(rows.find((row) => row.label === "これまでの発話")).toBeDefined();
  });

  it("emphasizes the first speech history item with a thicker bottom border", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: 4, nGramRaw: 4 },
      ],
    } as any);
    const markovRows = rows.filter(
      (r) => r.label === "これまでの発話" || r.label === "生成N-gram",
    );
    const html = renderToString(
      <MarkovModelStatusSection markovModelRows={markovRows} />,
    );

    expect(html).toContain("border-b");
    expect(html).toContain("border-b-emerald-300/80");
    expect(html).toContain(
      "border-bottom-width:var(--speech-history-border-bottom-width)",
    );
    expect(html).toContain("border-emerald-300/30");
  });

  it("normalizes object speech payloads for top-level speech", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speech: {
        speech: { text: "コメント", nodes: ["コメント"] },
        silent: false,
      },
    } as any);

    expect(rows.find((row) => row.label === "発話内容")?.value).toBe(
      "コメント",
    );
  });

  it("normalizes object speech payloads in speech history", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [
        {
          id: "speech-1",
          speech: { text: "コメント", nodes: ["コメント"] },
          nGram: 4,
          nGramRaw: 4,
        },
      ],
    } as any);
    const markovRows = rows.filter(
      (r) => r.label === "これまでの発話" || r.label === "生成N-gram",
    );
    const html = renderToString(
      <MarkovModelStatusSection markovModelRows={markovRows} />,
    );

    expect(html).toContain("コメント");
    expect((html.match(/speech-word-chip/g) || []).length).toBe(1);
  });

  it("renders markov trace nodes when available", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [
        {
          id: "speech-1",
          speech: "alpha beta gamma",
          nGram: 4,
          nodes: ["alpha", "beta", "gamma"],
        },
      ],
    } as any);
    const markovRows = rows.filter(
      (r) => r.label === "これまでの発話" || r.label === "生成N-gram",
    );
    const html = renderToString(
      <MarkovModelStatusSection markovModelRows={markovRows} />,
    );

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
    const html = renderToString(
      <MarkovModelStatusSection markovModelRows={[replyRow!] as any} />,
    );

    expect(html).toContain("返信先コメント");
    expect(html).toContain("このコメントに");
    expect(html).toContain("します");
    expect(html).toContain("返信");
    expect(html).toContain("bg-emerald-300/30");
  });

  it("normalizes numbered prefixes in reply target comments", () => {
    const html = renderToString(
      <>
        {createReplyTargetCommentValueComponent({
          text: "#2 コメント1わこつ2しかのこのこのここしたんたん",
          pickedTopic: "",
        })}
      </>,
    );

    expect(html).toContain("コメント1わこつ2しかのこのこのここしたんたん");
    expect(html).not.toContain("#2 ");
  });

  it("does not render a standalone reply row when speech history exists", () => {
    const rows = createAgentStatusRows({
      nGram: 4,
      speechHistory: [
        {
          id: "speech-1",
          speech: "alpha beta gamma",
          nGram: 4,
          nodes: ["alpha", "beta", "gamma"],
        },
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
        {
          id: "speech-1",
          speech: "alpha beta gamma",
          nGram: NaN,
          nodes: ["alpha", "beta", "gamma"],
        },
      ],
    } as any);
    const speechHistoryRow = rows.find((row) => row.label === "これまでの発話");
    expect(speechHistoryRow?.value).toBeUndefined();
    const html = renderToString(
      <MarkovModelStatusSection markovModelRows={[speechHistoryRow!] as any} />,
    );

    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("gamma");
    expect((html.match(/speech-word-chip/g) || []).length).toBe(3);
  });

  it("does not show detailed game state rows when currentGame is null", () => {
    const rows = createAgentStatusRows({ currentGame: null });
    expect(rows.find((row) => row.label === "ゲーム情報")).toBeUndefined();
  });

  it("falls back to niconama.meta.total.comments when top-level commentCount is missing", () => {
    const rows = createAgentStatusRows({
      niconama: {
        type: "live",
        meta: { total: { listeners: 3, comments: 99 } },
      },
    } as any);

    const liveRow = rows.find((r) => r.label === "配信指標");
    expect(liveRow).toBeDefined();
    const html = renderToString(<>{liveRow!.valueComponent}</>);
    expect(html).toContain("コメント数");
    expect(html).toContain("99");
  });

  it("does not include the recent comments row when the panel is closed", () => {
    const rows = createAgentStatusRows(
      {
        recentComments: [{ data: { no: 1, comment: "こんにちは" } }],
      } as any,
      { showRecentComments: false, toggleRecentComments: () => {} },
    );

    expect(rows.find((row) => row.label === "最近のコメント")).toBeUndefined();
  });

  it("includes the recent comments row when the panel is open", () => {
    const rows = createAgentStatusRows(
      {
        recentComments: [{ data: { no: 1, comment: "こんにちは" } }],
      } as any,
      { showRecentComments: true, toggleRecentComments: () => {} },
    );

    const recentRow = rows.find((row) => row.label === "最近のコメント");
    expect(recentRow).toBeDefined();
    const html = renderToString(<>{recentRow!.valueComponent}</>);
    expect(html).toContain('<span class="text-emerald-200">#1</span>');
    expect(html).toContain("こんにちは");
  });

  it("renders recent comments newest first", () => {
    const rows = createAgentStatusRows(
      {
        recentComments: [
          { data: { no: 1, comment: "古いコメント" } },
          { data: { no: 2, comment: "新しいコメント" } },
        ],
      } as any,
      { showRecentComments: true, toggleRecentComments: () => {} },
    );

    const recentRow = rows.find((row) => row.label === "最近のコメント");
    expect(recentRow).toBeDefined();
    const html = renderToString(<>{recentRow!.valueComponent}</>);
    const firstIndex = html.indexOf('<span class="text-emerald-200">#2</span>');
    const secondIndex = html.indexOf(
      '<span class="text-emerald-200">#1</span>',
    );
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it("renders comment count as a toggle button when a toggle callback is provided", () => {
    const rows = createAgentStatusRows(
      {
        niconama: {
          type: "live",
          meta: { total: { listeners: 3, comments: 99 } },
        },
      } as any,
      { showRecentComments: false, toggleRecentComments: () => {} },
    );

    const liveRow = rows.find((row) => row.label === "配信指標");
    expect(liveRow).toBeDefined();
    const html = renderToString(<>{liveRow!.valueComponent}</>);
    expect(html).toContain("<button");
    expect(html).toContain("99");
  });

  it("uses the explicit stream comment count when available", () => {
    const rows = createAgentStatusRows(
      {
        niconama: {
          type: "live",
          meta: { total: { listeners: 3, comments: 99 } },
        },
        commentCount: 80,
        recentComments: [
          { data: { no: 1, comment: "こんにちは" } },
          { data: { no: 2, comment: "テストコメント" } },
        ],
      } as any,
      { showRecentComments: false, toggleRecentComments: () => {} },
    );

    const liveRow = rows.find((row) => row.label === "配信指標");
    expect(liveRow).toBeDefined();
    const html = renderToString(<>{liveRow!.valueComponent}</>);
    expect(html).toContain(">80</button>");
  });

  it("falls back to recent comment count when no explicit total is available", () => {
    const rows = createAgentStatusRows(
      {
        niconama: { type: "live", meta: { total: { listeners: 3 } } },
        recentComments: [
          { data: { no: 1, comment: "こんにちは" } },
          { data: { no: 2, comment: "テストコメント" } },
        ],
      } as any,
      { showRecentComments: false, toggleRecentComments: () => {} },
    );

    const liveRow = rows.find((row) => row.label === "配信指標");
    expect(liveRow).toBeDefined();
    const html = renderToString(<>{liveRow!.valueComponent}</>);
    expect(html).toContain(">2</button>");
  });

  it("renders the same number of recent comment items as the comment count", () => {
    const rows = createAgentStatusRows(
      {
        niconama: {
          type: "live",
          meta: { total: { listeners: 3, comments: 99 } },
        },
        recentComments: [
          { data: { no: 1, comment: "こんにちは" } },
          { data: { no: 2, comment: "テストコメント" } },
          { data: { no: 3, comment: "こんばんは" } },
        ],
      } as any,
      { showRecentComments: true, toggleRecentComments: () => {} },
    );

    const liveRow = rows.find((row) => row.label === "配信指標");
    expect(liveRow).toBeDefined();
    const liveHtml = renderToString(<>{liveRow!.valueComponent}</>);
    expect(liveHtml).toContain("3");

    const recentRow = rows.find((row) => row.label === "最近のコメント");
    expect(recentRow).toBeDefined();
    const recentHtml = renderToString(<>{recentRow!.valueComponent}</>);
    expect((recentHtml.match(/<p\b/g) ?? []).length).toBe(3);
  });

  it("renders comment numbers with the last-updated color", () => {
    const rows = createAgentStatusRows(
      {
        recentComments: [{ data: { no: 12, comment: "テストコメント" } }],
      } as any,
      { showRecentComments: true, toggleRecentComments: () => {} },
    );

    const recentRow = rows.find((row) => row.label === "最近のコメント");
    expect(recentRow).toBeDefined();
    const html = renderToString(<>{recentRow!.valueComponent}</>);
    expect(html).toContain('<span class="text-emerald-200">#12</span>');
    expect(html).toContain("テストコメント");
  });

  it("merges a standalone numeric comment into the previous text comment when they appear as a pair", () => {
    const rows = createAgentStatusRows(
      {
        niconama: {
          type: "live",
          meta: { total: { listeners: 1, comments: 2 } },
        },
        recentComments: [
          { data: { comment: "ジュニアアイドル" } },
          { data: { comment: "16" } },
        ],
      } as any,
      { showRecentComments: true, toggleRecentComments: () => {} },
    );

    const recentRow = rows.find((row) => row.label === "最近のコメント");
    expect(recentRow).toBeDefined();
    const recentHtml = renderToString(<>{recentRow!.valueComponent}</>);
    expect(recentHtml).toContain('<span class="text-emerald-200">#16</span>');
    expect(recentHtml).toContain("ジュニアアイドル");
    expect((recentHtml.match(/<p\b/g) ?? []).length).toBe(1);
  });

  it("renders recent comments when the panel is open", () => {
    const rows = createAgentStatusRows(
      {
        recentComments: [
          { data: { no: 1, comment: "こんにちは" } },
          { data: { no: 2, comment: "テストコメント" } },
        ],
      } as any,
      { showRecentComments: true, toggleRecentComments: () => {} },
    );

    const recentRow = rows.find((row) => row.label === "最近のコメント");
    expect(recentRow).toBeDefined();
    const html = renderToString(<>{recentRow!.valueComponent}</>);
    expect(html).toContain('<span class="text-emerald-200">#1</span>');
    expect(html).toContain('<span class="text-emerald-200">#2</span>');
    expect(html).toContain("こんにちは");
    expect(html).toContain("テストコメント");
  });

  it("does not duplicate reply target comment when it matches a recent comment", () => {
    const rows = createAgentStatusRows(
      {
        recentComments: [{ data: { no: 1, comment: "わこつ" } }],
        replyTargetComment: { text: "わこつ", pickedTopic: "" },
      } as any,
      { showRecentComments: true, toggleRecentComments: () => {} },
    );

    expect(rows.find((row) => row.label === "最近のコメント")).toBeDefined();
    expect(rows.find((row) => row.label === "返信先コメント")).toBeUndefined();
  });

  it("does not duplicate reply target comment when it matches a numbered recent comment prefix", () => {
    const rows = createAgentStatusRows(
      {
        recentComments: [{ data: { no: 2, comment: "#2 わこつ" } }],
        replyTargetComment: { text: "#2 わこつ", pickedTopic: "" },
      } as any,
      { showRecentComments: true, toggleRecentComments: () => {} },
    );

    expect(rows.find((row) => row.label === "最近のコメント")).toBeDefined();
    expect(rows.find((row) => row.label === "返信先コメント")).toBeUndefined();
  });

  it("renders game section when currentGame present even if niconama is empty", () => {
    const rows = createAgentStatusRows({
      niconama: {},
      currentGame: {
        name: "CookieClicker",
        state: { clickableElementIds: ["ascendButton"], cookies: 123 },
      },
    } as any);

    const gameRow = rows.find((row) => row.label === "ゲーム情報");
    expect(gameRow).toBeDefined();
  });

  it("does not render live delivery row when niconama empty but still shows markov/game rows", () => {
    const rows = createAgentStatusRows({
      niconama: {},
      currentGame: { name: "CookieClicker", state: { ascendNumber: 1 } },
      speech: { speech: "テスト発話", silent: false },
    } as any);

    expect(rows.find((r) => r.label === "配信指標")).toBeUndefined();
    expect(rows.find((r) => r.label === "ゲーム情報")).toBeDefined();
    expect(rows.find((r) => r.label === "発話内容")).toBeDefined();
  });
});
