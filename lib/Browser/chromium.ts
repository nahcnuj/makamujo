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

/**
 * Resolve which executable to use for Chromium.
 * Priority: provided arg > CHROMIUM_EXECUTABLE_PATH env
 * Returns undefined if no valid executable (Playwright will use bundled).
 */
export function resolveExecutablePath(provided?: string): string | undefined {
  const candidate = provided || process.env.CHROMIUM_EXECUTABLE_PATH;
  if (candidate && existsSync(candidate)) {
    return candidate;
  }
  return undefined;
}

async function launchWithFallback<T>(
  extraFn: () => Promise<T>,
  plainFn: () => Promise<T>,
): Promise<T> {
  try {
    return await extraFn();
  } catch (firstErr) {
    console.warn(
      "[WARN]",
      "chromium-extra launch failed, retrying with plain playwright.chromium",
      firstErr,
    );
    return await plainFn();
  }
}

function getChromiumLaunchOptions(
  overrideExecutable: string | undefined,
  base: any = {},
) {
  const effective = resolveExecutablePath(overrideExecutable);
  const opts = { ...base };
  if (effective) {
    opts.executablePath = effective;
  } else {
    delete opts.executablePath;
  }
  return opts;
}

/**
 * Remove stale Chromium profile lock files that can block relaunch after a crash
 * (ProcessSingleton / SingletonLock errors). Ported from main #425.
 */
export function cleanupChromiumLockFiles(userDataDir: string): void {
  if (!existsSync(userDataDir)) {
    return;
  }
  const lockFiles = ["SingletonLock", "SingletonSocket", ".ssh"] as const;
  for (const lockFile of lockFiles) {
    const lockPath = join(userDataDir, lockFile);
    if (!existsSync(lockPath)) continue;
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

const isTransientLaunchError = (message: string): boolean =>
  /Failed to connect|spawn|ECONNREFUSED|pipe|Timeout|ProcessSingleton|SingletonLock/i.test(
    message,
  );

/**
 * Launch a persistent context with the correct executable resolution.
 * Retries transient subprocess errors and cleans stale lock files (#425, #431 from main).
 */
export async function launchPersistentContext(
  userDataDir: string,
  options: Record<string, unknown> = {},
) {
  cleanupChromiumLockFiles(userDataDir);

  const launchOpts = getChromiumLaunchOptions(
    typeof options.executablePath === "string"
      ? options.executablePath
      : undefined,
    options,
  );
  const maxRetries = 3;
  const baseRetryDelayMs = 500;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await launchWithFallback(
        () => chromium.launchPersistentContext(userDataDir, launchOpts),
        () =>
          playwright.chromium.launchPersistentContext(userDataDir, launchOpts),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(message);

      if (/ProcessSingleton|SingletonLock/i.test(message)) {
        try {
          const tmpDir = mkdtempSync(join(tmpdir(), "playwright-"));
          cleanupChromiumLockFiles(tmpDir);
          console.warn(
            "[WARN] userDataDir locked, retrying with temp dir",
            tmpDir,
          );
          return await launchWithFallback(
            () => chromium.launchPersistentContext(tmpDir, launchOpts),
            () =>
              playwright.chromium.launchPersistentContext(tmpDir, launchOpts),
          );
        } catch {
          // fall through to retry / rethrow
        }
      }

      if (isTransientLaunchError(message) && attempt < maxRetries - 1) {
        const delayMs = baseRetryDelayMs * 2 ** attempt;
        console.warn(
          `[WARN] launchPersistentContext transient error (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms:`,
          message,
        );
        await setTimeout(delayMs);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("launchPersistentContext failed");
}

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

  const effectiveExecutablePath = resolveExecutablePath(executablePath);
  const launchOpts = getChromiumLaunchOptions(executablePath, {
    headless: process.env.CHROMIUM_HEADLESS === "1",
    timeout: launchTimeout,
    // https://peter.sh/experiments/chromium-command-line-switches/
    args: [
      "--hide-scrollbars",
      "--window-size=1024,576", // It may be required by `--window-position`.
      "--window-position=1280,600",
    ],
  });

  console.log(
    "[INFO] launching browser",
    effectiveExecutablePath
      ? `with executablePath=${effectiveExecutablePath}`
      : "using Playwright bundled Chromium (no executablePath)",
  );

  const fallbackTimeout = 300000;

  const cloneLaunchOpts = (base: typeof launchOpts) => ({
    ...base,
    args: [...base.args],
  });

  const launchWith = async (baseOpts: typeof launchOpts) => {
    const firstTryOpts = cloneLaunchOpts(baseOpts);
    const plainOpts = cloneLaunchOpts(baseOpts);
    return await launchWithFallback(
      () => chromium.launch(firstTryOpts),
      () => playwright.chromium.launch(plainOpts),
    );
  };

  let browser;
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
      if (err instanceof Error) {
        err.message =
          `Failed to launch Chromium. ` +
          `Make sure you have run "bunx playwright install chromium" (or "playwright install chromium") ` +
          `after updating Playwright. ` +
          `If you want to force a system browser set CHROMIUM_EXECUTABLE_PATH.\n` +
          `Original error: ${err.message}`;
      }
      throw err;
    }
  }

  const ctx = await browser.newContext({
    viewport,
  });
  ctx.setDefaultTimeout(0);

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
      const ls = page.getByText(text, { exact: true }).or(page.getByText(text));
      let retry = true;
      let attempts = 0;
      const maxAttempts = 5;
      do {
        if (attempts >= maxAttempts) {
          throw new Error(
            `clickByText: "${text}" not found or not clickable after ${maxAttempts} attempt(s)`,
          );
        }
        attempts++;
        if ((await ls.count()) > 0) {
          console.debug(
            "[DEBUG]",
            "clickByText targets:",
            await ls.allInnerTexts(),
          );
          for (const l of await ls.all()) {
            try {
              await l.click({ timeout: 1_000 });
              retry = false;
              break;
            } catch (err) {
              console.warn("[WARN]", err);
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
        const evaluated = globalThis.eval(`(${fnSource})`) as (
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
    await page.locator(`#${id}`).first().click({ timeout: 5_000 });
  };
