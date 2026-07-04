import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

describe("docs/index.html", () => {
  let dom: JSDOM;
  let twqCalls: any[][];

  beforeEach(() => {
    const fullHtml = readFileSync("docs/index.html", "utf-8");
    twqCalls = [];

    // Extract just the bodies of the two X-related scripts (base + handler) reliably.
    // We do not rely on <script> execution or runScripts to avoid Proxy/fetch issues in JSDOM.
    const scriptContents: string[] = [];
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
    let m: RegExpExecArray | null;
    while ((m = scriptRegex.exec(fullHtml)) !== null) {
      const code = m[1] ?? "";
      if (code.includes("twq") || code.includes("live-link")) {
        scriptContents.push(code.trim());
      }
    }
    const baseCode = scriptContents[0] || "";
    const handlerCode = scriptContents[1] || "";

    // Parse the HTML normally (scripts stripped implicitly by not running; DOM structure is what we need)
    const cleanHtml = fullHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    dom = new JSDOM(cleanHtml, { url: "https://example.com/" });

    const window: any = dom.window;

    // Spy function
    function recordTwq(...args: any[]) {
      twqCalls.push(args);
    }
    window.twq = recordTwq;
    window.__twqCalls = twqCalls;

    // Patch and eval the codes using fully qualified globals to avoid "not defined" in eval scope.
    // This simulates the top level execution of the tracking scripts on "page load".
    // Use new Function to execute handler code (IIFE) providing document and twq as params.
    // This avoids bare "window"/"document" resolution problems inside eval().
    if (handlerCode) {
      try {
        const injector = new window.Function("document", "twq", handlerCode);
        injector(window.document, recordTwq);
      } catch (e) {
        // non-fatal for test
      }
    }
  });

  afterEach(() => {
    if (dom) {
      dom.window.close();
    }
  });

  it("does not call twq('event', ...) on page load", () => {
    // The conversion event tracking must NOT be invoked on page load.
    // (The base code may call twq('config'), but event tracking is click-only.)
    const eventCalls = twqCalls.filter(
      (c) => c[0] === "event" && c[1] === "tw-ov0j6-rdexl",
    );
    expect(eventCalls.length).toBe(0);

    // No event calls at all on load.
    const anyEventCalls = twqCalls.filter((c) => c[0] === "event");
    expect(anyEventCalls.length).toBe(0);
  });

  it("calls the X event tracking code when the niconico live link is clicked", () => {
    const liveLink = dom.window.document.getElementById("live-link");
    expect(liveLink).not.toBeNull();

    // Ensure no event before click
    let specificEvents = twqCalls.filter(
      (c) => c[0] === "event" && c[1] === "tw-ov0j6-rdexl",
    );
    expect(specificEvents.length).toBe(0);

    // Simulate click on the link
    liveLink!.dispatchEvent(
      new (dom.window as any).MouseEvent("click", { bubbles: true }),
    );

    specificEvents = twqCalls.filter(
      (c) => c[0] === "event" && c[1] === "tw-ov0j6-rdexl",
    );
    expect(specificEvents.length).toBe(1);
  });
});
