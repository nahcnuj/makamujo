import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentStateResponse } from "./types";
import { createAgentStatusRows } from "./createAgentStatusRows";
import { GameStatusSection } from "./GameStatusSection";
import { LiveDeliveryStatusSection } from "./LiveDeliveryStatusSection";
import { MarkovModelStatusSection } from "./MarkovModelStatusSection";

describe("AgentStatusSections", () => {
  it("renders live delivery section with title and link", () => {
    const html = renderToStaticMarkup(
      <LiveDeliveryStatusSection
        liveDeliveryRows={[
          {
            label: "配信状況",
            valueComponent: (
              <div>
                <h3>配信状況</h3>
                <p>配信中</p>
              </div>
            ),
          },
          { label: "配信URL", value: "https://example.com/live", href: "https://example.com/live" },
        ]}
      />,
    );

    expect(html).toContain("配信状況");
    expect(html).toContain("配信中");
    expect(html).toContain("https://example.com/live");
  });

  it("creates a single live delivery row with a 5-column metric grid", () => {
    const state: AgentStateResponse = {
      niconama: {
        type: "live",
        meta: {
          total: {
            listeners: 123,
            comments: 0,
            gift: 5,
            ad: 1,
          },
        },
      },
    };

    const rows = createAgentStatusRows(state);

    expect(rows).toHaveLength(1);
    const liveDeliveryRow = rows[0];
    if (!liveDeliveryRow) {
      throw new Error("Expected live delivery row to be defined");
    }
    expect(liveDeliveryRow).toMatchObject({ label: "配信状況", hideLabel: true });
    const html = renderToStaticMarkup(<>{liveDeliveryRow.valueComponent}</>);
    expect(html).toContain("配信状況");
    expect(html).toContain("配信中");
    expect(html).toContain("視聴者数");
    expect(html).toContain("コメント数");
    expect(html).toContain("ギフト");
    expect(html).toContain("広告");
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
                  <p>n=4</p>
                  <button type="button" disabled aria-label="学習の取り消し">↩</button>
                </li>
              </ul>
            ),
          },
        ]}
      />,
    );

    expect(html).toContain("マルコフ連鎖モデル");
    expect(html).toContain("4-gram");
    expect(html).toContain("テスト発話");
    expect(html).toContain("これまでの発話");
    expect(html).toContain("aria-label=\"学習の取り消し\"");
  });

  it("renders game section with structured rows", () => {
    const html = renderToStaticMarkup(
      <GameStatusSection
        title="『org.dashnet.orteil/cookieclicker』プレイ中"
        gameRows={[
          {
            label: "ゲーム情報",
            hideLabel: true,
            valueComponent: (
              <ul>
                <li>status: idle</li>
              </ul>
            ),
          },
        ]}
      />,
    );

    expect(html).toContain("『org.dashnet.orteil/cookieclicker』プレイ中");
    expect(html).not.toContain("現在のゲーム");
    expect(html).toContain("ゲーム情報");
    expect(html).toContain("<ul");
  });

  it("renders exactly one h3 per section and only one 配信状況 in the live delivery section", () => {
    const rows = createAgentStatusRows({
      niconama: {
        type: "live",
        meta: {
          total: { listeners: 10, comments: 1, gift: 2, ad: 3 },
        },
      },
    });
    const liveDeliveryRow = rows[0];
    if (!liveDeliveryRow) {
      throw new Error("Expected live delivery row to be defined");
    }
    const liveDeliveryHtml = renderToStaticMarkup(<>{liveDeliveryRow.valueComponent}</>);
    expect((liveDeliveryHtml.match(/<h3\b/g) || []).length).toBe(1);
    expect((liveDeliveryHtml.match(/配信状況/g) || []).length).toBe(1);

    const markovHtml = renderToStaticMarkup(
      <MarkovModelStatusSection
        markovModelRows={[
          { label: "生成N-gram", value: "4-gram" },
        ]}
      />,
    );
    expect((markovHtml.match(/<h3\b/g) || []).length).toBe(1);

    const gameHtml = renderToStaticMarkup(
      <GameStatusSection
        title="『org.dashnet.orteil/cookieclicker』プレイ中"
        gameRows={[{ label: "ゲーム情報", hideLabel: true, valueComponent: <span>status: idle</span> }]}
      />,
    );
    expect((gameHtml.match(/<h3\b/g) || []).length).toBe(1);
  });
});
