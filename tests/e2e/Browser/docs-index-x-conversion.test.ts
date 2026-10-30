import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.describe("docs/index.html X conversion tracking (real browser)", () => {
  test("calls twq with value and currency when the live link is clicked", async ({
    page,
  }) => {
    const fullHtml = readFileSync("docs/index.html", "utf-8");

    page.on("console", () => undefined);
    await page.setContent(fullHtml, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      (window as unknown as { __twqCalls: unknown[][] }).__twqCalls = [];
      (window as unknown as { twq: (...args: unknown[]) => void }).twq = (
        ...args: unknown[]
      ) => {
        (window as unknown as { __twqCalls: unknown[][] }).__twqCalls.push(
          args,
        );
      };
    });

    await page
      .click("#live-link", { noWaitAfter: true })
      .catch(() => undefined);
    await page.waitForTimeout(200);

    const calls = await page.evaluate(
      () => (window as unknown as { __twqCalls: unknown[][] }).__twqCalls,
    );

    const eventCalls = (calls as unknown[][]).filter(
      (c) => c[0] === "event" && c[1] === "tw-ov0j6-rdexl",
    );
    expect(eventCalls.length).toBe(1);
    expect(eventCalls[0]?.[2]).toMatchObject({
      value: 5,
      currency: "USD",
    });
  });
});
