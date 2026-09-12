import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { Browser } from "automated-gameplay-transmitter";
import type { Page, ViewportSize } from "playwright";
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
): Promise<Browser & { reload: () => Promise<void> }> => {
  const launchTimeout = Number.parseInt(
    process.env.CHROMIUM_LAUNCH_TIMEOUT ?? "60000",
    10,
  );
  const gameHomeUrl =
    process.env.GAME_HOME_URL?.trim() ||
    "https://www.nahcnuj.work/vigilant-fiesta/";

  const userDataDir = join(tmpdir(), `makamujo-game-${process.pid}`);
  mkdirSync(join(userDataDir, "Default"), { recursive: true });
  writeFileSync(
    join(userDataDir, "Default", "Preferences"),
    JSON.stringify({
      translate: { enabled: false },
      browser: { translate: { enabled: false } },
    }),
  );

  const effectiveExecutablePath = resolveExecutablePath(executablePath);
  console.log(
    "[INFO] launching browser (persistent --app)",
    effectiveExecutablePath
      ? `with executablePath=${effectiveExecutablePath}`
      : "using Playwright bundled Chromium",
  );

  const launchOpts = {
    headless: process.env.CHROMIUM_HEADLESS === "1",
    timeout: launchTimeout,
    ignoreDefaultArgs: ["--no-startup-window"] as string[],
    locale: "ja-JP",
    viewport,
    extraHTTPHeaders: { "Accept-Language": "ja" },
    executablePath: effectiveExecutablePath,
    args: [
      "--hide-scrollbars",
      `--window-size=${viewport.width},${viewport.height}`,
      "--window-position=1280,40",
      "--disable-features=Translate,TranslateUI,TranslateScript,OptimizationHints",
      "--disable-translate",
      "--lang=ja",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--app=${gameHomeUrl}`,
    ],
  };

  // Drop undefined executablePath for Playwright
  if (!launchOpts.executablePath) {
    delete (launchOpts as { executablePath?: string }).executablePath;
  }

  const ctx = await chromium.launchPersistentContext(userDataDir, launchOpts);

  // Reuse --app window only (do not open a second tabbed window)
  let page = ctx.pages()[0];
  if (!page) {
    page = await ctx.newPage();
  }
  for (const extra of ctx.pages().slice(1)) {
    await extra.close().catch(() => {});
  }
  page = ctx.pages()[0] ?? page;

  if (!page.url().startsWith(gameHomeUrl) && page.url() !== "about:blank") {
    // keep
  } else if (
    page.url() === "about:blank" ||
    !page.url().startsWith(gameHomeUrl)
  ) {
    await page
      .goto(gameHomeUrl, { waitUntil: "domcontentloaded" })
      .catch(() => {});
  }

  ctx.on("page", createPopupPageHandler(page));

  const dismissCloseButtons = async () => {
    try {
      const roots = [page, ...page.frames()];
      for (const f of roots) {
        const buttons = f.getByText("閉じる", { exact: true });
        const n = await buttons.count().catch(() => 0);
        for (let i = 0; i < n; i++) {
          const b = buttons.nth(i);
          if (await b.isVisible().catch(() => false)) {
            await b.click({ timeout: 500 }).catch(() => {});
          }
        }
      }
    } catch {
      /* best-effort */
    }
  };
  setInterval(() => {
    void dismissCloseButtons();
  }, 2000);

  const applyZoom = async () => {
    try {
      await page.evaluate(() => {
        document.documentElement.style.zoom = "1.25";
        window.scrollTo(0, 0);
      });
    } catch {
      /* page may not be ready */
    }
  };
  await applyZoom();
  page.on("load", () => {
    void applyZoom();
  });

  page.on(
    "framenavigated",
    createRedirectToHomeHandler(page.mainFrame(), gameHomeUrl, (url) =>
      page.goto(url, { waitUntil: "domcontentloaded" }),
    ),
  );

  return {
    open: async (url: string) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    close: async () => {
      await ctx.close();
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
        .getByRole(role as Parameters<Page["getByRole"]>[0])
        .fill(value);
    },

    evaluate: async (f) => {
      return await page.evaluate((fnSource) => {
        // Reconstruct the function in the page context from its source string.
        // biome-ignore lint/security/noGlobalEval: required to run caller fn in page.evaluate
        const evaluated = globalThis.eval(`(${fnSource})`) as (
          document: Document,
        ) => ReturnType<typeof f>;
        return evaluated(document);
      }, f.toString());
    },

    reload: async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
    },
    get url() {
      return page.url();
    },
  } as Browser & { reload: () => Promise<void> };
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
