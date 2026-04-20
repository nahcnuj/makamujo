import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./App";

describe("App layout", () => {
  it("uses a full-height grid with a fixed header row and content row", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("h-full");
    expect(html).toContain("grid-rows-[auto_minmax(0,1fr)]");
  });
});
