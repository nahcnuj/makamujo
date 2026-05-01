import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentStatus } from "./index";

describe("AgentStatus component", () => {
  it("renders the root status container with layout classes", () => {
    const html = renderToStaticMarkup(<AgentStatus />);
    expect(html).toContain("max-w-7xl");
    expect(html).toContain("h-full");
    expect(html).toContain("grid-rows-[auto_minmax(0,1fr)]");
  });
});
