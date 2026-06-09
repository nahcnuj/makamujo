import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { Browser } from "automated-gameplay-transmitter";
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
  const launchTimeout = Number.parseInt(
    process.env.CHROMIUM_LAUNCH_TIMEOUT ?? "60000",
    10,
  );
  // If an explicit executablePath was provided but the file doesn't exist,
  // ignore it and fall back to the Playwright channel mode so that
  // installed Playwright browsers can be used in CI environments.
  const effectiveExecutablePath =
    executablePath && existsSync(executablePath) ? executablePath : undefined;

  const launchOpts = {
    ...(effectiveExecutablePath
      ? { executablePath: effectiveExecutablePath }
      : { channel: "chromium" }),
    headless: process.env.CHROMIUM_HEADLESS === "1",
    timeout: launchTimeout,
    // https://peter.sh/experiments/chromium-command-line-switches/
    args: [
      "--hide-scrollbars",
      "--window-size=1024,576", // It may be required by `--window-position`.
      "--window-position=1280,600",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-popup-blocking",
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
      console.warn(
        "[WARN]",
        "chromium-extra launch failed, retrying with playwright.chromium",
        firstErr,
      );
      const fallbackOpts = cloneLaunchOpts(baseOpts);
      return await playwright.chromium.launch(fallbackOpts);
    }
  };

  let browser: Awaited<ReturnType<typeof launchWith>>;
  try {
    browser = await launchWith(launchOpts);
  } catch (err) {
    if (
      launchTimeout < fallbackTimeout &&
      err instanceof Error &&
      /Timeout/.test(err.message)
    ) {
      console.warn(
        "[WARN]",
        `launch timeout ${launchTimeout}ms exceeded, retrying with ${fallbackTimeout}ms`,
      );
      const fallbackOpts = { ...launchOpts, timeout: fallbackTimeout };
      browser = await launchWith(fallbackOpts);
    } else {
      throw err;
    }
  }

  const ctx = await browser.newContext({
    viewport,
  });
  ctx.setDefaultTimeout(30_000);

  const page = await ctx.newPage();

  const cookieclickerUrl = "https://orteil.dashnet.org/cookieclicker/";

  // Close any new tabs (e.g. ad popups) that open in the browser context.
  ctx.on("page", createPopupPageHandler(page));

  // If the main page navigates away from Cookie Clicker, redirect it back.
  page.on(
    "framenavigated",
    createRedirectToHomeHandler(page.mainFrame(), cookieclickerUrl, (url) =>
      page.goto(url, { waitUntil: "domcontentloaded" }),
    ),
  );

  return {
    open: async (url: string) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    close: async () => {
      await ctx.close();
      await browser.close();
    },

    clickByText: async (text) => {
      const locatorFactories: Array<() => any> = [
        () => page.getByRole("button", { name: text, exact: true } as any),
        () => page.getByRole("button", { name: text } as any),
        () => page.getByText(text, { exact: true }),
        () => page.getByText(text),
        () => page.locator(`text=${JSON.stringify(text)}`),
        () => page.locator(`text=${text}`),
      ];

      let attempts = 0;
      const maxAttempts = 7;
      while (attempts < maxAttempts) {
        attempts += 1;
        let clicked = false;

        for (const createLocator of locatorFactories) {
          let locator: any;
          try {
            locator = createLocator();
          } catch {
            continue;
          }

          let count = 0;
          try {
            count = await locator.count({ timeout: 1_000 });
          } catch {
            count = 0;
          }

          if (count === 0) continue;

          let targetTexts: string[] = [];
          try {
            targetTexts = await locator.allInnerTexts();
          } catch {
            targetTexts = [];
          }
          console.debug("[DEBUG]", "clickByText targets:", targetTexts);

          const elements = await locator.all();
          for (const element of elements) {
            try {
              await element.click({ timeout: 2_000 });
              clicked = true;
              break;
            } catch (err) {
              console.warn("[WARN]", "clickByText element click failed", err);
            }
          }

          if (clicked) break;
        }

        if (clicked) return;
        await setTimeout(1_000);
      }

      throw new Error(
        `clickByText: "${text}" not found or not clickable after ${maxAttempts} attempt(s)`,
      );
    },
    clickByElementId: createClickByElementId(page),

    press: async (key, selector) => {
      await page.locator(selector).press(key);
    },

    fillByRole: async (value, role, selector) => {
      await page
        .locator(selector)
        .getByRole(role as any)
        .fill(value);
    },

    evaluate: async (f) => {
      return await page.evaluate((fnSource) => {
        // Use Function constructor instead of eval for security
        const evaluated = new Function(`return (${fnSource})`)() as (
          document: Document,
        ) => ReturnType<typeof f>;
        return evaluated(document);
      }, f.toString());
    },

    get url() {
      return page.url();
    },
  } satisfies Browser;
};

type PageLike = { url(): string; close(): Promise<void> };

/**
 * Returns an event handler for the BrowserContext `page` event that immediately
 * closes any page other than the designated main page (e.g. ad popup tabs).
 */
export const createPopupPageHandler =
  (mainPage: PageLike) =>
  async (newPage: PageLike): Promise<void> => {
    if (newPage !== mainPage) {
      console.warn("[WARN]", "Closing unexpected new tab:", newPage.url());
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
  redirectTo: (url: string) => Promise<unknown>,
) => {
  let isRedirecting = false;
  return (frame: FrameLike): void => {
    if (frame !== mainFrame) return;
    const url = frame.url();
    if (url === "about:blank") return;
    if (url.startsWith(homeUrl)) {
      isRedirecting = false;
      return;
    }
    if (isRedirecting) return;
    isRedirecting = true;
    console.warn(
      "[WARN]",
      "Main page navigated away from home, redirecting back:",
      url,
    );
    redirectTo(homeUrl).catch((redirectError) => {
      isRedirecting = false;
      console.warn("[WARN]", "Failed to redirect back to home:", redirectError);
    });
  };
};

type LocatorLike = {
  first(): LocatorLike;
  click(options?: { timeout?: number }): Promise<void>;
};

type ClickablePageLike = {
  locator(selector: string): LocatorLike;
};

/**
 * Returns a function that clicks the first element matching the given ID selector,
 * even when multiple elements in the DOM share the same `id` attribute.
 */
export const createClickByElementId =
  (page: ClickablePageLike) =>
  async (id: string): Promise<void> => {
    // Prefer a DOM-evaluated click when available (real Playwright Page)
    // to avoid visibility/stability flakiness. Fall back to the locator
    // approach used in tests which provides a minimal `locator()` API.
    const anyPage = page as any;
    if (typeof anyPage.evaluate === "function") {
      const clicked = await anyPage.evaluate((targetId: string) => {
        const els = Array.from(
          document.querySelectorAll(`#${CSS.escape(targetId)}`),
        );
        const el = els[0] as HTMLElement | undefined;
        if (!el) return false;
        el.click();
        return true;
      }, id);
      if (!clicked) {
        throw new Error(
          `createClickByElementId: element with id "${id}" not found`,
        );
      }
      return;
    }

    // Fallback for test doubles that only expose `locator()`.
    await page.locator(`#${id}`).first().click({ timeout: 5_000 });
  };

// Defaults used by other modules.
export const DEFAULT_PLAYWRIGHT_USER_DATA_DIR =
  process.env.PLAYWRIGHT_USER_DATA_DIR ?? "/tmp/playwright-user-data";
export const DEFAULT_CHROMIUM_EXECUTABLE_PATH =
  process.env.CHROMIUM_EXECUTABLE_PATH ?? "";

// Clean up Chromium lock files that may prevent launching a new instance.
// This helps avoid "ProcessSingleton" errors when a previous instance crashed
// or didn't clean up properly.
const cleanupChromiumLockFiles = (userDataDir: string): void => {
  if (!existsSync(userDataDir)) {
    return;
  }

  const lockFiles = ["SingletonLock", "SingletonSocket", ".ssh"];
  for (const lockFile of lockFiles) {
    const lockPath = join(userDataDir, lockFile);
    if (existsSync(lockPath)) {
      try {
        rmSync(lockPath, { force: true, recursive: true });
        console.warn(`[WARN] cleaned up lock file: ${lockPath}`);
      } catch (err) {
        console.warn(
          `[WARN] failed to clean up lock file ${lockPath}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }
};

// Provide a launchPersistentContext helper that prefers playwright-extra's
// chromium wrapper but falls back to Playwright's chromium implementation.
export const launchPersistentContext = async (
  userDataDir: string,
  options: Record<string, unknown> = {},
) => {
  // Clean up any stale lock files before attempting to launch
  cleanupChromiumLockFiles(userDataDir);

  const maxRetries = 3;
  const baseRetryDelayMs = 500;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (typeof (chromium as any).launchPersistentContext === "function") {
        try {
          return await (chromium as any).launchPersistentContext(
            userDataDir,
            options as any,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/ProcessSingleton|SingletonLock/i.test(msg)) {
            // Profile appears locked; create a temporary user data dir to avoid
            // the ProcessSingleton conflict and retry.
            try {
              const tmpDir = mkdtempSync(join(tmpdir(), "playwright-"));
              cleanupChromiumLockFiles(tmpDir);
              console.warn(
                "[WARN] userDataDir locked, retrying with temp dir",
                tmpDir,
              );
              return await (chromium as any).launchPersistentContext(
                tmpDir,
                options as any,
              );
            } catch (_err2) {
              // Fall through to rethrow original error below.
            }
          }
          // Check for transient connection errors
          if (
            /Failed to connect|spawn|ECONNREFUSED|pipe|Timeout/i.test(msg) &&
            attempt < maxRetries - 1
          ) {
            lastError = err instanceof Error ? err : new Error(String(err));
            const delayMs = baseRetryDelayMs * 2 ** attempt;
            console.warn(
              `[WARN] launchPersistentContext transient error (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms:`,
              msg,
            );
            await setTimeout(delayMs);
            continue;
          }
          throw err;
        }
      }
      try {
        return await playwright.chromium.launchPersistentContext(
          userDataDir,
          options as any,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/ProcessSingleton|SingletonLock/i.test(msg)) {
          try {
            const tmpDir = mkdtempSync(join(tmpdir(), "playwright-"));
            cleanupChromiumLockFiles(tmpDir);
            console.warn(
              "[WARN] userDataDir locked, retrying with temp dir",
              tmpDir,
            );
            return await playwright.chromium.launchPersistentContext(
              tmpDir,
              options as any,
            );
          } catch (_err2) {
            // fall through
          }
        }
        // Check for transient connection errors
        if (
          /Failed to connect|spawn|ECONNREFUSED|pipe|Timeout/i.test(msg) &&
          attempt < maxRetries - 1
        ) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const delayMs = baseRetryDelayMs * 2 ** attempt;
          console.warn(
            `[WARN] launchPersistentContext fallback transient error (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms:`,
            msg,
          );
          await setTimeout(delayMs);
          continue;
        }
        throw err;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries - 1) {
        throw lastError;
      }
    }
  }
  if (lastError) {
    throw lastError;
  }
};
