import type { Browser } from "automated-gameplay-transmitter";
import { setTimeout } from "node:timers/promises";
import type { ViewportSize } from "playwright";
import playwright from "playwright";
import { chromium as $_ } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

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

    clickByText: async (name) => {
      const target = page.getByRole('button', { name, exact: true })
        .or(page.getByRole('button', { name })).first()
        .or(
          page.getByRole('link', { name, exact: true })
            .or(page.getByRole('link', { name }))
            .first(),
        ).first();
      do {
        console.debug('[DEBUG]', 'clickByText target:', await target.allInnerTexts());
        if (await target.count() > 0) {
          try {
            await target.click();
            break;
          } catch (err) {
            console.warn('[WARN]', err);
          }
        } else {
          await setTimeout(1_000);
        }
      } while (true);
    },
    clickByElementId: async (id) => {
      await page.locator(`#${id}`).click();
    },

    press: async (key, selector) => {
      await page.locator(selector).press(key);
    },

    fillByRole: async (value, role, selector) => {
      await page.locator(selector).getByRole(role as any).fill(value);
    },

    evaluate: async (f) => {
      return await page.evaluate(f);
    },

    get url() { return page.url() },
  } satisfies Browser;
};
