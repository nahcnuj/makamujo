import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

describe("docs/index.html", () => {
  let dom: JSDOM;
  let twqCalls: unknown[][];

  beforeEach(() => {
    const fullHtml = readFileSync("docs/index.html", "utf-8");
    twqCalls = [];

    const scriptContents: string[] = [];
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(fullHtml)) !== null) {
      const code = match[1] ?? "";
      if (code.includes("twq") || code.includes("live-link")) {
        scriptContents.push(code.trim());
      }
    }
    const handlerCode = scriptContents[1] || "";

    const cleanHtml = fullHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    dom = new JSDOM(cleanHtml, { url: "https://example.com/" });

    const window = dom.window as unknown as Window & {
      twq: (...args: unknown[]) => void;
    };

    function recordTwq(...args: unknown[]) {
      twqCalls.push(args);
    }
    window.twq = recordTwq;

    if (handlerCode) {
      try {
        const injector = new (
          window as unknown as { Function: typeof Function }
        ).Function("document", "twq", handlerCode);
        injector(window.document, recordTwq);
      } catch {
        // non-fatal for structural tests
      }
    }
  });

  afterEach(() => {
    if (dom) {
      dom.window.close();
    }
  });

  it("does not call twq('event', ...) on page load", () => {
    const eventCalls = twqCalls.filter(
      (c) => c[0] === "event" && c[1] === "tw-ov0j6-rdexl",
    );
    expect(eventCalls.length).toBe(0);

    const anyEventCalls = twqCalls.filter((c) => c[0] === "event");
    expect(anyEventCalls.length).toBe(0);
  });

  it("calls the X event tracking code when the niconico live link is clicked", () => {
    const liveLink = dom.window.document.getElementById("live-link");
    expect(liveLink).not.toBeNull();

    let specificEvents = twqCalls.filter(
      (c) => c[0] === "event" && c[1] === "tw-ov0j6-rdexl",
    );
    expect(specificEvents.length).toBe(0);

    liveLink!.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );

    specificEvents = twqCalls.filter(
      (c) => c[0] === "event" && c[1] === "tw-ov0j6-rdexl",
    );
    expect(specificEvents.length).toBe(1);
  });
});
