import { expect, test } from "@playwright/test";
import { createChromiumBrowser } from "../../lib/Browser/chromium";

test.describe("chromium Browser evaluate", () => {
  test("browser create evaluate() works with document", async () => {
    const browser = await createChromiumBrowser(undefined, { width: 640, height: 480 });
    try {
      await browser.open('data:text/html,<title>test-evaluate</title><body><div id="x">hello</div></body>');
      const title = await browser.evaluate(() => document.title);
      const text = await browser.evaluate(() => document.getElementById('x')?.textContent);
      expect(title).toBe('test-evaluate');
      expect(text).toBe('hello');
    } finally {
      await browser.close();
    }
  });
});
