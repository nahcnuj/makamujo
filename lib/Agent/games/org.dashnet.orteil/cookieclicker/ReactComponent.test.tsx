import { describe, expect, it } from "bun:test";
import Component from "./ReactComponent";
import type { State } from "./State";

const baseState = {
  cookies: 0,
  cps: 0,
  isWrinkled: false,
  ascendNumber: 0,
  store: {
    products: { bulkMode: "buy" as const, items: [] },
    upgrades: [],
    tech: [],
    switches: [],
  },
} satisfies Omit<State, "statistics">;

async function renderHtml(state: State): Promise<string> {
  const node = Component({ state }) as unknown;
  if (typeof node === "string") return node;
  if (node != null && typeof (node as { toString?: unknown }).toString === "function") {
    const s = (node as { toString: () => string | Promise<string> }).toString();
    return typeof s === "string" ? s : await s;
  }
  return String(node);
}

describe("CookieClicker ReactComponent", () => {
  it("shows generation and click count when statistics are enriched", async () => {
    const html = await renderHtml({
      ...baseState,
      statistics: {
        general: {
          "遺産の始まり：": {
            innerText: " 362日前, 昇天 107回",
            ascensions: 107,
            daysAgo: 362,
          },
          "クリック回数：": {
            innerText: " 1,009",
            value: 1009,
          },
        } as NonNullable<State["statistics"]>["general"],
      },
    });
    expect(html).toContain("107世代目");
    expect(html).toContain("クリック 1,009回");
  });

  it("shows placeholders when statistics are missing", async () => {
    const html = await renderHtml({ ...baseState });
    expect(html).toContain("—世代目");
    expect(html).toContain("クリック —回");
  });

  it("shows placeholders when values are not yet parsed", async () => {
    const html = await renderHtml({
      ...baseState,
      statistics: {
        general: {
          "遺産の始まり：": { innerText: " 362日前" },
          "クリック回数：": { innerText: " 不明" },
        },
      },
    });
    expect(html).toContain("—世代目");
    expect(html).toContain("クリック —回");
  });
});
