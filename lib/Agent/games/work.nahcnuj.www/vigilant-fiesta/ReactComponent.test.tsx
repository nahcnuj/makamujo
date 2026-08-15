import { describe, expect, it } from "bun:test";
import Component, { GAME_PUBLIC_URL } from "./ReactComponent";
import type { State } from "./State";

const baseState = {
  screen: "playing" as const,
  score: Number.NaN,
  level: Number.NaN,
  scoreText: "",
  levelText: "",
  url: GAME_PUBLIC_URL,
  title: "t",
  selectedText: "",
  timestamp: 0,
} satisfies State;

async function renderHtml(state: State): Promise<string> {
  const node = Component({ state }) as unknown;
  if (typeof node === "string") return node;
  if (
    node != null &&
    typeof (node as { toString?: unknown }).toString === "function"
  ) {
    const s = (node as { toString: () => string | Promise<string> }).toString();
    return typeof s === "string" ? s : await s;
  }
  return String(node);
}

describe("VigilantFiesta ReactComponent", () => {
  it("shows score, level, high scores, and QR", async () => {
    const html = await renderHtml({
      ...baseState,
      score: 42,
      level: 3,
      scoreText: "Score: 42",
      levelText: "Level: 3",
      sessionBest: 100,
      allTimeBest: 500,
    });
    expect(html).toContain("42");
    expect(html).toContain("3");
    expect(html).toContain("100");
    expect(html).toContain("500");
    expect(html).toContain("最高(枠内)");
    expect(html).toContain("最高(通算)");
    expect(html).toContain("/vigilant-fiesta-qr.svg");
    expect(html).toContain(GAME_PUBLIC_URL);
  });

  it("still shows records and QR when score is non-finite", async () => {
    const html = await renderHtml({
      ...baseState,
      screen: "title",
      sessionBest: 0,
      allTimeBest: 12,
    });
    expect(html).toContain("最高(枠内)");
    expect(html).toContain("最高(通算)");
    expect(html).toContain("12");
    expect(html).toContain("/vigilant-fiesta-qr.svg");
  });
});
