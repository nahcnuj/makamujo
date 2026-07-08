import { describe, it, expect } from "bun:test";
import { getDefaultBrowserPath } from "./getDefaultBrowserPath";

describe("getDefaultBrowserPath", () => {
  it("returns undefined by default (lets Playwright use its bundled browser)", () => {
    expect(getDefaultBrowserPath("linux")).toBeUndefined();
    expect(getDefaultBrowserPath("win32" as NodeJS.Platform)).toBeUndefined();
    expect(getDefaultBrowserPath("darwin")).toBeUndefined();
  });

  it("prefers env.CHROMIUM_EXECUTABLE_PATH when set", () => {
    expect(getDefaultBrowserPath("win32" as NodeJS.Platform, { ...process.env, CHROMIUM_EXECUTABLE_PATH: "C:\\local\\chrome.exe" })).toBe("C:\\local\\chrome.exe");
    expect(getDefaultBrowserPath("linux", { ...process.env, CHROMIUM_EXECUTABLE_PATH: "/usr/bin/chromium" })).toBe("/usr/bin/chromium");
  });

  it("ignores platform when CHROMIUM_EXECUTABLE_PATH is set", () => {
    expect(getDefaultBrowserPath("linux", { CHROMIUM_EXECUTABLE_PATH: "/opt/chrome/chrome" })).toBe("/opt/chrome/chrome");
  });
});
