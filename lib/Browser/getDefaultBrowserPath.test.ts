import { describe, it, expect } from "bun:test";
import { getDefaultBrowserPath } from "./getDefaultBrowserPath";

describe("getDefaultBrowserPath", () => {
  it("returns /usr/bin/chromium for linux by default", () => {
    expect(getDefaultBrowserPath("linux")).toBe("/usr/bin/chromium");
  });

  it("returns empty string for windows by default", () => {
    expect(getDefaultBrowserPath("win32" as NodeJS.Platform)).toBe("");
  });

  it("returns darwin bundle path for macos", () => {
    expect(getDefaultBrowserPath("darwin")).toBe("/Applications/Chromium.app/Contents/MacOS/Chromium");
  });

  it("prefers env.CHROMIUM_EXECUTABLE_PATH when set", () => {
    expect(getDefaultBrowserPath("win32" as NodeJS.Platform, { ...process.env, CHROMIUM_EXECUTABLE_PATH: "C:\\local\\chrome.exe" })).toBe("C:\\local\\chrome.exe");
  });
});
