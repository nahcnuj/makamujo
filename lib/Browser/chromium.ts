import type { Browser } from "automated-gameplay-transmitter";
import { setTimeout } from "node:timers/promises";
import type { ViewportSize } from "playwright";
import playwright from "playwright";
import { chromium as $_ } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

export const chromium = $_.use(StealthPlugin());

export const create = async (
  executablePath?: string,
  viewport: ViewportSize = {
    width: 1280,
    height: 720,
  },
): Promise<Browser> => {
  const launchTimeout = Number.parseInt(process.env.CHROMIUM_LAUNCH_TIMEOUT ?? '60000', 10);
  const launchOpts = {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    headless: false,
    timeout: launchTimeout,
    // https://peter.sh/experiments/chromium-command-line-switches/
    args: [
      '--hide-scrollbars',
      '--window-size=1024,576', // It may be required by `--window-position`.
      '--window-position=1280,600',
    ],
  };

  const fallbackTimeout = 300000;

  const launchWith = async (options: typeof launchOpts) => {
    try {
      return await chromium.launch(options);
    } catch (firstErr) {
      console.warn('[WARN]', 'chromium-extra launch failed, retrying with playwright.chromium', firstErr);
      return await playwright.chromium.launch(options);
    }
  };

  let browser;
  try {
    browser = await launchWith(launchOpts);
  } catch (err) {
    if (launchTimeout < fallbackTimeout && err instanceof Error && /Timeout/.test(err.message)) {
      console.warn('[WARN]', `launch timeout ${launchTimeout}ms exceeded, retrying with ${fallbackTimeout}ms`);
      const fallbackOpts = { ...launchOpts, timeout: fallbackTimeout };
      browser = await launchWith(fallbackOpts);
    } else {
      throw err;
    }
  }

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

    clickByText: async (text) => {
      const ls = page.getByText(text, { exact: true }).or(page.getByText(text));
      let retry = true;
      do {
        if (await ls.count() > 0) {
          console.debug('[DEBUG]', 'clickByText targets:', await ls.allInnerTexts());
          for (const l of await ls.all()) {
            try {
              await l.click({ timeout: 1_000 });
              retry = false;
              break;
            } catch (err) {
              console.warn('[WARN]', err);
            }
          }
        } else {
          await setTimeout(1_000);
        }
      } while (retry);
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
