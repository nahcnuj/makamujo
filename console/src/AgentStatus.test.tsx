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
          { label: "状態", value: "配信中" },
          { label: "配信URL", value: "https://example.com/live", href: "https://example.com/live" },
        ]}
      />,
    );
    expect(html).toContain("配信状況");
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
            value: "1. テスト発話 (生成時N-gram: 4-gram (4))",
            valueComponent: (
              <ul>
                <li>
                  <p>テスト発話</p>
                  <p>生成時N-gram: 4-gram (4)</p>
                  <button type="button" disabled>発話をキャンセル（仮）</button>
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
    expect(html).toContain("発話をキャンセル（仮）");
  });

  it("renders game rows", () => {
    const html = renderToStaticMarkup(
        <GameStatusSection
          gameRows={[
            { label: "現在のゲーム", value: "org.dashnet.orteil/cookieclicker" },
            {
              label: "ゲーム情報",
              value: "status: idle",
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
});
