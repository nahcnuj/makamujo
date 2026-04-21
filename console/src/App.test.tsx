import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./App";

describe("App layout", () => {
  it("renders agent status in a full-height container", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("h-full");
    expect(html).toContain("馬可無序");
  });
});
