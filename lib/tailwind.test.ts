import { test, expect } from "bun:test";
import { compileTailwindCss } from "./tailwind";

test("compiles main Tailwind CSS without unresolved directives and includes app utilities", async () => {
  const css = await compileTailwindCss("src/index.css");
  expect(css).not.toContain("@apply");
  expect(css).not.toContain("@theme");
  expect(css).toContain(":root");
  expect(css).toContain("body");
  expect(css).toContain("bg-emerald-950");
  expect(css).toContain("grid");
});

test("compiles console Tailwind CSS without unresolved directives and includes console utilities", async () => {
  const css = await compileTailwindCss("console/src/index.css");
  expect(css).not.toContain("@apply");
  expect(css).not.toContain("@theme");
  expect(css).toContain(":root");
  expect(css).toContain("body");
  expect(css).toContain("w-full");
  expect(css).toContain("max-w-");
});
