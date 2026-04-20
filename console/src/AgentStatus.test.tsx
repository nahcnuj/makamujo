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
        ]}
      />,
    );
    expect(html).toContain("マルコフ連鎖モデルの状態");
    expect(html).toContain("4-gram");
    expect(html).toContain("テスト発話");
  });

  it("renders game rows", () => {
    const html = renderToStaticMarkup(
        <GameStatusSection
          gameRows={[
            { label: "現在のゲーム", value: "org.dashnet.orteil/cookieclicker" },
            { label: "ソルバー状態", value: "{\n  \"status\": \"idle\"\n}", isPreformatted: true },
          ]}
        />,
      );
    expect(html).toContain("ゲームの状態");
    expect(html).toContain("現在のゲーム");
    expect(html).toContain("org.dashnet.orteil/cookieclicker");
    expect(html).toContain("ソルバー状態");
  });
});
