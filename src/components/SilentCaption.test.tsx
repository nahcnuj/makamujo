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
});
