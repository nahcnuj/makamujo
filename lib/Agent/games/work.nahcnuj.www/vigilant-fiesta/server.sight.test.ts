import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { sight } from "./server";

const installDom = (bodyHtml: string, url = "https://www.nahcnuj.work/vigilant-fiesta/") => {
  const dom = new JSDOM(`<!DOCTYPE html><html><head><title>落ち物パズルゲーム・蘇</title></head><body>${bodyHtml}</body></html>`, {
    url,
  });
  const { window } = dom;
  // Prefer attribute visibility over empty getClientRects in JSDOM.
  window.HTMLElement.prototype.checkVisibility = function checkVisibility() {
    return !this.hasAttribute("hidden");
  };
  // Set globals for JSDOM (cast to any for strict mode)
  (globalThis as any).window = window;
  (globalThis as any).document = window.document;
  (globalThis as any).location = window.location;
  return dom;
};

afterEach(() => {
  // Clean up globals after each test
  (globalThis as any).document = undefined;
  (globalThis as any).window = undefined;
  (globalThis as any).location = undefined;
});

describe("vigilant-fiesta sight (DOM)", () => {
  it("detects title screen", () => {
    installDom(`
      <section id="screen-title"><button id="btn-start">スタート</button></section>
      <section id="screen-playing" hidden>
        <span id="score">Score: 0</span><span id="level">Level: 1</span>
      </section>
      <div id="result-overlay" hidden><p id="result-score">Score: 0</p></div>
    `);
    const s = sight();
    expect(s.screen).toBe("title");
  });

  it("detects playing screen with score and level", () => {
    installDom(`
      <section id="screen-title" hidden></section>
      <section id="screen-playing">
        <span id="score">Score: 1,234</span>
        <span id="level">Level: 7</span>
      </section>
      <div id="result-overlay" hidden><p id="result-score">Score: 0</p></div>
    `);
    const s = sight();
    expect(s.screen).toBe("playing");
    expect(s.score).toBe(1234);
    expect(s.level).toBe(7);
  });

  it("detects result overlay and prefers result-score", () => {
    installDom(`
      <section id="screen-title" hidden></section>
      <section id="screen-playing" hidden>
        <span id="score">Score: 10</span>
        <span id="level">Level: 2</span>
      </section>
      <div id="result-overlay">
        <p id="result-score">Score: 999</p>
        <button id="btn-retry">もう一度</button>
      </div>
    `);
    const s = sight();
    expect(s.screen).toBe("result");
    expect(s.score).toBe(999);
  });

  it("returns unknown when no screens are visible", () => {
    installDom(`
      <section id="screen-title" hidden></section>
      <section id="screen-playing" hidden></section>
      <div id="result-overlay" hidden></div>
    `);
    expect(sight().screen).toBe("unknown");
  });
});
