import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentStatus } from "../../../console/src/AgentStatus";

describe("AgentStatus layout", () => {
  it("uses a wider default max width for the status container", () => {
    const html = renderToStaticMarkup(<AgentStatus />);
    expect(html).toContain("max-w-7xl");
  });
});
