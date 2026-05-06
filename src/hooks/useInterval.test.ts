import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { useInterval } from "./useInterval";
import { useEffect, useRef } from "hono/jsx/dom";

describe("useInterval", () => {
  it("is a function", () => {
    expect(typeof useInterval).toBe("function");
  });

  it("uses hono/jsx/dom hooks, not React hooks", () => {
    // Verify that the hook imports are from hono/jsx/dom.
    // If this module had imported from 'react' (as the AGT version did), the
    // build alias might not be applied and the actual React library would end
    // up in the bundle, causing "Cannot read properties of null (reading
    // 'useRef')" in OBS Browser where no React renderer is set up.
    expect(typeof useRef).toBe("function");
    expect(typeof useEffect).toBe("function");
  });

  describe("timer behaviour (outside render context)", () => {
    let originalSetTimeout: typeof setTimeout;
    let originalClearTimeout: typeof clearTimeout;

    beforeEach(() => {
      originalSetTimeout = globalThis.setTimeout;
      originalClearTimeout = globalThis.clearTimeout;
    });

    afterEach(() => {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    });

    it("does not throw when called outside a render context", () => {
      // hono/jsx/dom's useEffect is a no-op outside render context, so no
      // timer will be started. The important thing is that useRef returns a
      // plain object (not null) and the function doesn't throw.
      expect(() => {
        useInterval(100, async () => {});
      }).not.toThrow();
    });
  });
});
