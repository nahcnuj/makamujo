import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { jsx, render } from "hono/jsx/dom";
import { JSDOM } from "jsdom";
import { ScreenReaderOnly } from "./ScreenReaderOnly";
import {
  animationDelayMs,
  graphemeList,
  SpeechLine,
  stripTrailingPeriod,
} from "./SpeechLine";

describe("stripTrailingPeriod", () => {
  it("removes only a trailing 。", () => {
    expect(stripTrailingPeriod("こんにちは。")).toBe("こんにちは");
    expect(stripTrailingPeriod("。。")).toBe("。");
    expect(stripTrailingPeriod("こんにちは")).toBe("こんにちは");
    expect(stripTrailingPeriod("")).toBe("");
  });
});

describe("graphemeList", () => {
  it("counts JP and emoji as graphemes", () => {
    expect(graphemeList("あ！").length).toBe(2);
    expect(graphemeList("a😀b").length).toBe(3);
  });

  it("returns empty for empty string", () => {
    expect(graphemeList("")).toEqual([]);
  });
});

describe("animationDelayMs", () => {
  it("staggers by MS_PER_CHAR", () => {
    expect(animationDelayMs(0)).toBe(0);
    expect(animationDelayMs(1)).toBe(55);
    expect(animationDelayMs(10)).toBe(550);
  });
});

describe("render", () => {
  let root: HTMLElement;
  let dom: JSDOM;

  beforeAll(() => {
    dom = new JSDOM(
      "<!doctype html><html><body><div id='root'></div></body></html>",
    );
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    root = document.getElementById("root")!;
  });

  afterAll(() => {
    dom.window.close();
  });

  it("ScreenReaderOnly keeps text without display:none", () => {
    root.replaceChildren();
    render(jsx(ScreenReaderOnly as never, { children: "hello" }), root);
    const el = root.firstElementChild as HTMLElement;
    expect(root.textContent).toBe("hello");
    expect(el.style.position).toBe("absolute");
    expect(el.style.display).not.toBe("none");
  });

  it("SpeechLine: AT text + grapheme spans + delay", () => {
    root.replaceChildren();
    render(jsx(SpeechLine as never, { text: "ab。", animate: true }), root);

    expect(root.textContent).toContain("ab");
    const visual = root.querySelector("[aria-hidden='true']");
    expect(visual?.textContent).toBe("ab");
    const spans = [
      ...visual!.querySelectorAll(":scope > span"),
    ] as HTMLElement[];
    expect(spans).toHaveLength(2);
    expect(spans[0]!.style.animationDelay).toBe(`${animationDelayMs(0)}ms`);
    expect(spans[1]!.style.animationDelay).toBe(`${animationDelayMs(1)}ms`);
  });

  it("SpeechLine: no animation styles when animate is false", () => {
    root.replaceChildren();
    render(jsx(SpeechLine as never, { text: "ab", animate: false }), root);
    const spans = [
      ...root.querySelectorAll("[aria-hidden='true'] > span"),
    ] as HTMLElement[];
    expect(spans[0]!.style.animationDelay).toBe("");
    expect(spans[0]!.style.opacity).toBe("");
  });
});
