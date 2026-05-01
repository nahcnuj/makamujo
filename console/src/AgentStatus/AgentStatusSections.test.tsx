import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GameStatusSection } from "./GameStatusSection";
import { LiveDeliveryStatusSection } from "./LiveDeliveryStatusSection";
import { MarkovModelStatusSection } from "./MarkovModelStatusSection";

describe("AgentStatusSections", () => {
  it("renders live delivery section with title and link", () => {
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

  it("renders markov model section with speech history", () => {
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

  it("renders game section with structured rows", () => {
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
});
