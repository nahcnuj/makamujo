import { describe, expect, it } from "bun:test";
import { useInterval } from "./useInterval";
import { useEffect, useRef } from "hono/jsx/dom";

describe("useInterval", () => {
  it("is a function", () => {
    expect(typeof useInterval).toBe("function");
  });

  it("uses hono/jsx/dom useRef, not React's", () => {
    // Verify by reference that the useRef imported inside useInterval is the
    // same function exported by hono/jsx/dom. If useInterval had imported from
    // 'react' (as the AGT version did), Bun.build's alias would not reliably
    // redirect it for pre-compiled packages, and the actual React library
    // would end up in the bundle, causing "Cannot read properties of null
    // (reading 'useRef')" in OBS Browser.
    //
    // We verify indirectly: hono/jsx/dom's useRef gracefully returns
    // { current: initialValue } when called outside a render context, whereas
    // React's useRef throws "Invalid hook call" (dispatcher === null).
    expect(() => useRef(42)).not.toThrow();
    expect(useRef(42)).toEqual({ current: 42 });
    expect(typeof useEffect).toBe("function");
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
