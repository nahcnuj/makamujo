import { expect, test } from "@playwright/test";
import { DEFAULT_FALLBACK_WATCH_URL } from "../../lib/niconamaCommentClient";

const parseEmbeddedDataProps = (dataProps: string): unknown | null => {
  try {
    return JSON.parse(dataProps.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } catch {
    return null;
  }
};

test.describe("Niconama fallback watch page", () => {
  test("contains embedded-data with relive websocket URL", async ({ page }) => {
    await page.goto(DEFAULT_FALLBACK_WATCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    const embeddedData = await page.locator('#embedded-data').first();
    await expect(embeddedData).toBeVisible({ timeout: 30000 });

    const dataProps = await embeddedData.getAttribute('data-props');
    expect(dataProps).toBeTruthy();

    const embedded = parseEmbeddedDataProps(dataProps ?? '');
    expect(embedded).toBeTruthy();
    expect(typeof embedded).toBe('object');
    expect((embedded as any).site?.state?.relive?.webSocketUrl).toBeTruthy();
    expect((embedded as any).site?.state?.relive?.webSocketUrl).toMatch(/^wss:\/\//);
  });
});
