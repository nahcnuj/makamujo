import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentStatus } from "./AgentStatus";
import { GameStatusSection } from "./agentStatusSections/GameStatusSection";
import { LiveDeliveryStatusSection } from "./agentStatusSections/LiveDeliveryStatusSection";
import { MarkovModelStatusSection } from "./agentStatusSections/MarkovModelStatusSection";

describe("AgentStatus layout", () => {
  it("uses a wider default max width for the status container", () => {
    const html = renderToStaticMarkup(<AgentStatus />);
    expect(html).toContain("max-w-7xl");
    expect(html).toContain("h-full");
    expect(html).toContain("min-h-0");
    expect(html).toContain("grid-rows-[auto_minmax(0,1fr)]");
  });
});

describe("AgentStatus category sections", () => {
  it("renders live delivery rows", () => {
    const html = renderToStaticMarkup(
      <LiveDeliveryStatusSection
        liveDeliveryRows={[
          {
            label: "配信指標",
            valueComponent: (
              <div>
                <p>状態</p>
                <p>配信中</p>
              </div>
            ),
          },
          { label: "配信URL", value: "https://example.com/live", href: "https://example.com/live" },
        ]}
      />,
    );
    expect(html).toContain("配信状況");
    expect(html).toContain("配信指標");
    expect(html).toContain("状態");
    expect(html).toContain("配信中");
    expect(html).toContain("https://example.com/live");
  });

  it("renders markov model rows", () => {
    const html = renderToStaticMarkup(
      <MarkovModelStatusSection
        markovModelRows={[
          { label: "生成N-gram", value: "4-gram" },
          { label: "発話内容", value: "テスト発話" },
          {
            label: "これまでの発話",
            valueComponent: (
              <ul>
                <li>
                  <p>テスト発話</p>
                  <p>4g</p>
                  <button type="button" disabled aria-label="学習の取り消し">↩</button>
                </li>
              </ul>
            ),
          },
        ]}
      />,
    );
    expect(html).toContain("マルコフ連鎖モデルの状態");
    expect(html).toContain("4-gram");
    expect(html).toContain("テスト発話");
    expect(html).toContain("これまでの発話");
    expect(html).toContain("aria-label=\"学習の取り消し\"");
  });

  it("renders game rows", () => {
    const html = renderToStaticMarkup(
        <GameStatusSection
          gameRows={[
            { label: "現在のゲーム", value: "org.dashnet.orteil/cookieclicker" },
            {
              label: "ゲーム情報",
              valueComponent: (
                <ul>
                  <li>status: idle</li>
                </ul>
              ),
            },
          ]}
        />,
      );
    expect(html).toContain("ゲームの状態");
    expect(html).toContain("現在のゲーム");
    expect(html).toContain("org.dashnet.orteil/cookieclicker");
    expect(html).toContain("ゲーム情報");
    expect(html).toContain("<ul");
  });

  it("renders speech history words as separate cards", () => {
    const stateResponse = {
      nGram: 4,
      speechHistory: [
        { id: "speech-1", speech: "alpha beta gamma", nGram: 4 },
      ],
    } as any;

    const rows = require("./AgentStatus").createAgentStatusRows(stateResponse);
    const markovRows = rows.filter((r: any) => r.label === "これまでの発話" || r.label === "生成N-gram");
    const html = renderToStaticMarkup(<MarkovModelStatusSection markovModelRows={markovRows} />);

    expect(html).toContain("これまでの発話");
    // Expect each word to be rendered as a separate card element with distinctive class
    expect((html.match(/speech-word-chip/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
