import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentStatusSectionCard } from "./AgentStatusSectionCard";

describe("AgentStatusSectionCard", () => {
  it("renders section title and rows including link rows", () => {
    const html = renderToStaticMarkup(
      <AgentStatusSectionCard
        title="テストセクション"
        rows={[
          { label: "状態", value: "配信中" },
          { label: "配信URL", value: "https://example.com/live", href: "https://example.com/live" },
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

    expect(html).toContain("テストセクション");
    expect(html).toContain("状態");
    expect(html).toContain("配信中");
    expect(html).toContain("href=\"https://example.com/live\"");
    expect(html).toContain("<ul");
  });
});
