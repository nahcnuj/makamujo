import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { render } from "hono/jsx/dom";
import { SilentCaption } from "./SilentCaption";

const CAPTION_TEXT = "（コメントしてね）";

describe("SilentCaption portal lifecycle", () => {
  let dom: JSDOM;
  let container: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
      url: "http://localhost/",
      pretendToBeVisual: true,
    });

    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.Element = dom.window.Element;
    globalThis.Node = dom.window.Node;
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      return dom.window.setTimeout(() => cb(Date.now()), 0) as unknown as number;
    };
    globalThis.cancelAnimationFrame = (id: number) => {
      dom.window.clearTimeout(id);
    };

    // Element.animate の簡易モック（jsdom には無い）
    if (!dom.window.Element.prototype.animate) {
      dom.window.Element.prototype.animate = function () {
        return {
          finished: Promise.resolve(),
          cancel() {},
          play() {},
          pause() {},
        } as unknown as Animation;
      };
    }

    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document
      .querySelectorAll("[data-silent-caption-portal]")
      .forEach((el) => el.remove());
    container.remove();
  });

  it("shows the caption text in the DOM while mounted", async () => {
    render(<SilentCaption text={CAPTION_TEXT} />, container);
    await new Promise((r) => setTimeout(r, 50));

    expect(document.body.textContent).toContain(CAPTION_TEXT);
  });

  it("removes the caption text from the DOM on unmount", async () => {
    render(<SilentCaption text={CAPTION_TEXT} />, container);
    await new Promise((r) => setTimeout(r, 50));

    expect(document.body.textContent).toContain(CAPTION_TEXT);

    // アンマウント
    render(null, container);
    await new Promise((r) => setTimeout(r, 50));

    // ★ アンマウント後は「（コメントしてね）」がDOMに含まれない
    expect(document.body.textContent).not.toContain(CAPTION_TEXT);
  });

  it("does not leave caption text after mount → unmount → mount → unmount", async () => {
    // 1回目マウント
    render(<SilentCaption text={CAPTION_TEXT} />, container);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).toContain(CAPTION_TEXT);

    // アンマウント
    render(null, container);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).not.toContain(CAPTION_TEXT);

    // 2回目マウント
    render(<SilentCaption text={CAPTION_TEXT} />, container);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).toContain(CAPTION_TEXT);

    // 最終アンマウント
    render(null, container);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).not.toContain(CAPTION_TEXT);
  });
});
