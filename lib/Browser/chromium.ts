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
    headless: process.env.CHROMIUM_HEADLESS === '1',
    timeout: launchTimeout,
    // https://peter.sh/experiments/chromium-command-line-switches/
    args: [
      '--hide-scrollbars',
      '--window-size=1024,576', // It may be required by `--window-position`.
      '--window-position=1280,600',
    ],
  };

  const fallbackTimeout = 300000;

  const cloneLaunchOpts = (base: typeof launchOpts) => ({
    ...base,
    args: [...base.args],
  });

  const launchWith = async (baseOpts: typeof launchOpts) => {
    const firstTryOpts = cloneLaunchOpts(baseOpts);
    try {
      return await chromium.launch(firstTryOpts);
    } catch (firstErr) {
      console.warn('[WARN]', 'chromium-extra launch failed, retrying with playwright.chromium', firstErr);
      const fallbackOpts = cloneLaunchOpts(baseOpts);
      return await playwright.chromium.launch(fallbackOpts);
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

  const cookieclickerUrl = 'https://orteil.dashnet.org/cookieclicker/';

  // Close any new tabs (e.g. ad popups) that open in the browser context.
  ctx.on('page', createPopupPageHandler(page));

  // If the main page navigates away from Cookie Clicker, redirect it back.
  page.on('framenavigated', createRedirectToHomeHandler(
    page.mainFrame(),
    cookieclickerUrl,
    (url) => page.goto(url, { waitUntil: 'domcontentloaded' }),
  ));

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
      let attempts = 0;
      const maxAttempts = 5;
      do {
        if (attempts >= maxAttempts) {
          throw new Error(`clickByText: "${text}" not found or not clickable after ${maxAttempts} attempt(s)`);
        }
        attempts++;
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
          if (retry) {
            await setTimeout(1_000);
          }
        } else {
          await setTimeout(1_000);
        }
      } while (retry);
    },
    clickByElementId: async (id) => {
      await page.locator(`#${id}`).first().click({ timeout: 5_000 });
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

type PageLike = { url(): string; close(): Promise<void> };

/**
 * Returns an event handler for the BrowserContext `page` event that immediately
 * closes any page other than the designated main page (e.g. ad popup tabs).
 */
export const createPopupPageHandler = (mainPage: PageLike) =>
  async (newPage: PageLike): Promise<void> => {
    if (newPage !== mainPage) {
      console.warn('[WARN]', 'Closing unexpected new tab:', newPage.url());
      await newPage.close();
    }
  };

type FrameLike = { url(): string };

/**
 * Returns an event handler for the Page `framenavigated` event that redirects
 * the main frame back to `homeUrl` whenever it navigates to any other URL.
 * A guard flag prevents multiple concurrent redirects from being queued.
 */
export const createRedirectToHomeHandler = (
  mainFrame: FrameLike,
  homeUrl: string,
  redirectTo: (url: string) => Promise<void>,
) => {
  let isRedirecting = false;
  return (frame: FrameLike): void => {
    if (frame !== mainFrame) return;
    const url = frame.url();
    if (url === 'about:blank') return;
    if (url.startsWith(homeUrl)) {
      isRedirecting = false;
      return;
    }
    if (isRedirecting) return;
    isRedirecting = true;
    console.warn('[WARN]', 'Main page navigated away from home, redirecting back:', url);
    redirectTo(homeUrl).catch((redirectError) => {
      isRedirecting = false;
      console.warn('[WARN]', 'Failed to redirect back to home:', redirectError);
    });
  };
};
