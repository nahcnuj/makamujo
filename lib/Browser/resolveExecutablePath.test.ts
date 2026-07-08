import { describe, it, expect } from "bun:test";
import { resolveExecutablePath } from "./chromium";

describe("resolveExecutablePath", () => {
  it("returns undefined by default (lets Playwright use its bundled browser)", () => {
    expect(resolveExecutablePath()).toBeUndefined();
    expect(resolveExecutablePath(undefined)).toBeUndefined();
  });

  it("returns provided path if it exists on disk", () => {
    // process.execPath is always a valid existing executable
    const exec = process.execPath;
    expect(resolveExecutablePath(exec)).toBe(exec);
  });

  it("returns undefined for non-existing provided path", () => {
    expect(resolveExecutablePath("/non/existent/path/to/chrome")).toBeUndefined();
  });

  it("falls back to CHROMIUM_EXECUTABLE_PATH env (if set and exists)", () => {
    const exec = process.execPath;
    const original = process.env.CHROMIUM_EXECUTABLE_PATH;
    process.env.CHROMIUM_EXECUTABLE_PATH = exec;
    try {
      expect(resolveExecutablePath()).toBe(exec);
      expect(resolveExecutablePath("/non/existent")).toBeUndefined(); // provided wins only if exists, else env?
      // Actually current: provided first, even if not exist? Wait, code: if provided, use only if exists, else env?
      // Current impl: candidate = provided || env; then if candidate && exists return it.
      // So if bad provided, candidate=bad, !exists => undef, ignores env.
      // To test env, use no provided.
    } finally {
      if (original === undefined) delete process.env.CHROMIUM_EXECUTABLE_PATH;
      else process.env.CHROMIUM_EXECUTABLE_PATH = original;
    }
  });
});
