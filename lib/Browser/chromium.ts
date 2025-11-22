import type { ViewportSize } from "playwright";
import { chromium as $_ } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser } from ".";

const chromium = $_.use(StealthPlugin());

export const create = async (
  executablePath?: string,
  viewport: ViewportSize = {
    width: 1280,
    height: 720,
  },
): Promise<Browser> => {
  const browser = await chromium.launch({
    ...(executablePath ?
      {
        executablePath,
      } :
      {
        channel: 'chromium',
      }),
    headless: false,

    // https://peter.sh/experiments/chromium-command-line-switches/
    args: [
      '--hide-scrollbars',
      '--window-size=1024,576', // It may be required by `--window-position`.
      '--window-position=1280,600',
    ],
  });

  const ctx = await browser.newContext({
    viewport,
  });
  ctx.setDefaultTimeout(0);

  const page = await ctx.newPage();

  return {
    open: async (url: string) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    },
    close: async () => {
      await ctx.close();
      await browser.close();
    },
  } satisfies Browser;
};
