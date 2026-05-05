/** @jsxImportSource hono/jsx */
import { describe, expect, it } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { AgentStatusHeader } from "./AgentStatusHeader";

describe("AgentStatusHeader", () => {
  it("renders the stream title as a link and shows the start time", () => {
    const html = renderToString(
      <AgentStatusHeader
        streamTitle="配信タイトル"
        streamUrl="https://example.com/live"
        startTime="2026/05/02 12:34:56"
      />,
    );

    expect(html).toContain("配信タイトル");
    expect(html).toContain("href=\"https://example.com/live\"");
    expect(html).toContain("2026/05/02 12:34:56");
  });

  it("renders nothing when neither stream title nor start time is provided", () => {
    const html = renderToString(<AgentStatusHeader />);
    expect(html).toBe("");
  });
});
