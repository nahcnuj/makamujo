import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { createElement } from "hono/jsx";
import { JSDOM } from "jsdom";
import { AppBoundary, FrontendRoot } from "./frontendRoot";
import { mount } from "./mount";

const NOTICE_TEXT = "配信画面の描画に失敗しました";

function setupDom(): { dom: JSDOM; container: HTMLDivElement } {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
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

  if (!dom.window.Element.prototype.animate) {
    dom.window.Element.prototype.animate = () =>
      ({
        finished: Promise.resolve(),
        cancel() {},
        play() {},
        pause() {},
      }) as unknown as Animation;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  return { dom, container };
}

describe("AppBoundary", () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let consoleError: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    ({ dom, container } = setupDom());
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    container.remove();
    dom.window.close();
  });

  it("renders children unchanged when they render without errors", () => {
    mount(
      <AppBoundary>{createElement("p", null, "ok-app")}</AppBoundary>,
      container,
    );
    expect(container.textContent).toContain("ok-app");
  });

  it("renders the failure notice instead of a blank page when a child throws", () => {
    function Throws(): never {
      throw new Error("boom");
    }
    mount(<AppBoundary>{createElement(Throws, null)}</AppBoundary>, container);
    expect(container.textContent).toContain(NOTICE_TEXT);
    // 落ちた原因は握りつぶさない（観測できるように残す）。
    expect(consoleError).toHaveBeenCalledWith(
      "[ERROR] frontend render failed",
      expect.any(Error),
    );
  });
});

describe("FrontendRoot", () => {
  let dom: JSDOM;
  let container: HTMLDivElement;

  beforeEach(() => {
    ({ dom, container } = setupDom());
  });

  afterEach(() => {
    container.remove();
    dom.window.close();
  });

  it("renders the app wrapped inside the boundary", () => {
    const root = mount(<FrontendRoot />, container);
    // 鼓動の帯は HTML の静的な div（src/index.html）で動くので、ここでは
    // アプリのマウントが Boundary に包まれていることだけを確かめる。
    expect(container.textContent).toContain("馬");
    root.unmount();
  });
});
