import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { mount } from "../mount";
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
      return dom.window.setTimeout(
        () => cb(Date.now()),
        0,
      ) as unknown as number;
    };
    globalThis.cancelAnimationFrame = (id: number) => {
      dom.window.clearTimeout(id);
    };

    if (!dom.window.Element.prototype.animate) {
      dom.window.Element.prototype.animate = () =>
        ({
          finished: Promise.resolve(),
          cancel() {},
          play() {},
          pause() {},
        }) as unknown as Animation;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.querySelectorAll("[data-silent-caption-portal]").forEach((el) => {
      el.remove();
    });
    container.remove();
  });

  it("shows the caption text in the DOM while mounted", async () => {
    const root = mount(<SilentCaption text={CAPTION_TEXT} />, container);
    await new Promise((r) => setTimeout(r, 50));

    expect(document.body.textContent).toContain(CAPTION_TEXT);
    root.unmount();
  });

  it("removes the caption text from the DOM on unmount", async () => {
    const root = mount(<SilentCaption text={CAPTION_TEXT} />, container);
    await new Promise((r) => setTimeout(r, 50));

    expect(document.body.textContent).toContain(CAPTION_TEXT);

    root.unmount();
    await new Promise((r) => setTimeout(r, 50));

    expect(document.body.textContent).not.toContain(CAPTION_TEXT);
  });

  it("does not leave caption text after mount → unmount → mount → unmount", async () => {
    const root1 = mount(<SilentCaption text={CAPTION_TEXT} />, container);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).toContain(CAPTION_TEXT);

    root1.unmount();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).not.toContain(CAPTION_TEXT);

    const root2 = mount(<SilentCaption text={CAPTION_TEXT} />, container);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).toContain(CAPTION_TEXT);

    root2.unmount();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).not.toContain(CAPTION_TEXT);
  });

  it("keeps animating without a static hold", async () => {
    // 旧実装は PAUSE_MS (1500ms) / HOLD_MS (800ms) の待ちを挟んでいた。
    // 待ちの間は合成出力が完全に静止するので、外からの異常検知に停止と
    // みなされる (issue #995)。動き続けることだけを確かめる。
    const prototype = dom.window.Element.prototype;
    const originalAnimate = prototype.animate;
    let animations = 0;
    prototype.animate = function (
      this: Element,
      ...args: Parameters<typeof originalAnimate>
    ): Animation {
      animations += 1;
      return originalAnimate.apply(this, args);
    };

    const root = mount(<SilentCaption text={CAPTION_TEXT} />, container);
    await new Promise((r) => setTimeout(r, 150));
    root.unmount();
    prototype.animate = originalAnimate;

    expect(animations).toBeGreaterThan(4);
  });
});
