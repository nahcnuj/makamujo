import { describe, expect, it } from "bun:test";
import { create } from "./chromium";
import { getDefaultBrowserPath } from "./getDefaultBrowserPath";

describe("chromium Browser create", () => {
  it("should have create function", () => {
    expect(typeof create).toBe("function");
  });

  it("should create a Browser object and run simple evaluate when browser is available", async () => {
    const browserPath = getDefaultBrowserPath(process.platform);
    if (!browserPath) {
      console.warn("skipping chromium create test because no chromium executable path detected");
      return;
    }

    const browser = await create(undefined, { width: 320, height: 240 });
    try {
      await browser.open("data:text/html,<title>test</title><body><div id='x'>hello</div></body>");
      const title = await browser.evaluate((document) => document.title);
      const text = await browser.evaluate((document) => document.getElementById('x')?.textContent);
      expect(title).toBe("test");
      expect(text).toBe("hello");
    } finally {
      await browser.close();
    }
  }, 30000);
});
