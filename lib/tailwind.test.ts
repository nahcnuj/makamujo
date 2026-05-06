import { test, expect } from "bun:test";
import { compileTailwindCss } from "./tailwind";

test("compiles main Tailwind CSS without unresolved directives", async () => {
  const css = await compileTailwindCss("src/index.css");
  expect(css).not.toContain("@apply");
  expect(css).not.toContain("@theme");
  expect(css).toContain(":root");
  expect(css).toContain("body");
});

test("compiles console Tailwind CSS without unresolved directives", async () => {
  const css = await compileTailwindCss("console/src/index.css");
  expect(css).not.toContain("@apply");
  expect(css).not.toContain("@theme");
  expect(css).toContain(":root");
  expect(css).toContain("body");
});
