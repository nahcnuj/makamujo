import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import {
  APP_ROOT_ID,
  BROADCAST_HEARTBEAT_ROOT_ID,
  mountFrontend,
} from "./frontendMount";

describe("frontend mount", () => {
  let dom: JSDOM;
  let doc: Document;

  beforeEach(() => {
    dom = new JSDOM(
      `<!DOCTYPE html><html><body><div id="${APP_ROOT_ID}"></div><div id="${BROADCAST_HEARTBEAT_ROOT_ID}"></div></body></html>`,
      { url: "http://localhost/", pretendToBeVisual: true },
    );
    doc = dom.window.document;
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = doc;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.Element = dom.window.Element;
    globalThis.Node = dom.window.Node;
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
      dom.window.setTimeout(() => cb(Date.now()), 0) as unknown as number;
    globalThis.cancelAnimationFrame = (id: number) => {
      dom.window.clearTimeout(id);
    };
  });

  afterEach(() => {
    dom.window.close();
  });

  it("mounts the liveness band in its own root", () => {
    mountFrontend(doc, { renderApp: () => {} });

    const band = doc.querySelector(".broadcast-heartbeat");
    expect(band).not.toBeNull();
    expect(band?.parentElement?.id).toBe(BROADCAST_HEARTBEAT_ROOT_ID);
  });

  it("keeps the liveness band when the app render fails", () => {
    expect(() =>
      mountFrontend(doc, {
        renderApp: () => {
          throw new Error("app render failed");
        },
      }),
    ).toThrow("app render failed");

    expect(doc.querySelector(".broadcast-heartbeat")).not.toBeNull();
  });

  it("fails when the app root is missing", () => {
    doc.getElementById(APP_ROOT_ID)?.remove();

    expect(() => mountFrontend(doc, { renderApp: () => {} })).toThrow(
      "root element not found",
    );
  });
});
