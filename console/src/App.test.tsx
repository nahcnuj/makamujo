/** @jsxImportSource hono/jsx */
import { describe, expect, it } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { App } from "./App";

describe("App layout", () => {
  it("renders agent status in a full-height container", () => {
    const html = renderToString(<App />);
    expect(html).toContain("h-full");
    expect(html).toContain("馬可無序");
  });
});
