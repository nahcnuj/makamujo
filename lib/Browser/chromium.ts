import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { Browser } from "automated-gameplay-transmitter";
import type { Page, ViewportSize } from "playwright";
import playwright from "playwright";
import { chromium as $_ } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import {
  createTemporaryDirectory,
  GAME_BROWSER_TEMPORARY_DIRECTORY_PREFIX,
  PLAYWRIGHT_FALLBACK_TEMPORARY_DIRECTORY_PREFIX,
  removeTemporaryDirectory,
} from "../temporaryDirectory";

export const chromium = $_.use(StealthPlugin());

/**
 * How long an in-page `evaluate` may run before it is treated as a hang.
 *
 * Playwright's `page.evaluate` has no timeout of its own: when the renderer
 * stops answering (a crashed/frozen tab, or a wedged game page), the returned
 * promise never settles. The game session drives its whole IPC loop through
 * `evaluate`, so an unbounded call freezes the stream indefinitely — the
 * Aw, Snap! watchdog (which also evaluates) never fires and the supervisor
 * only restarts the process on a crash, not on a hang. Bounding it turns the
 * hang into an error the watchdog can react to (reload → restart).
 */
export const DEFAULT_EVALUATE_TIMEOUT_MS = 15_000;

/** A bounded browser call that did not settle within the allotted time. */
export class EvaluateTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} did not settle within ${timeoutMs}ms`);
    this.name = "EvaluateTimeoutError";
  }
}

/** Read `BROWSER_EVALUATE_TIMEOUT_MS`, falling back to the default. */
export const resolveEvaluateTimeoutMs = (
  env: NodeJS.ProcessEnv = process.env,
): number => {
  const parsed = Number.parseInt(env.BROWSER_EVALUATE_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_EVALUATE_TIMEOUT_MS;
};

/**
 * Reject with an {@link EvaluateTimeoutError} when `promise` has not settled
 * within `timeoutMs`. A non-positive timeout disables the bound (the promise
 * is returned unchanged), which keeps the helper safe to call with an unset
 * override.
 */
export const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = "browser.evaluate",
): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new EvaluateTimeoutError(label, timeoutMs));
    }, timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
};

/** Roots under which Chromium/browser binaries may be resolved. */
const listAllowedExecutableRoots = (): string[] => {
  const roots = [
    dirname(process.execPath),
    homedir(),
    tmpdir(),
    "/usr",
    "/opt",
    "/nix",
    "/Applications",
  ];
  if (process.platform === "win32") {
    for (const key of [
      "ProgramFiles",
      "ProgramFiles(x86)",
      "ProgramW6432",
      "LOCALAPPDATA",
    ] as const) {
      const value = process.env[key];
      if (value) roots.push(value);
    }
  }
  return roots;
};

/**
 * Resolve which executable to use for Chromium.
 * Priority: provided arg > CHROMIUM_EXECUTABLE_PATH env
 * Returns undefined if no valid executable (Playwright will use bundled).
 *
 * FS probes run only inside a positive `startsWith(rootPrefix)` branch — the
 * containment shape CodeQL recognizes for js/path-injection.
 */
export function resolveExecutablePath(provided?: string): string | undefined {
  const raw = provided || process.env.CHROMIUM_EXECUTABLE_PATH;
  if (!raw || raw.includes("\0") || !isAbsolute(raw)) {
    return undefined;
  }
  const resolved = resolve(raw);
  for (const root of listAllowedExecutableRoots()) {
    const rootPrefix = `${resolve(root)}${sep}`;
    // Positive startsWith only (no === / negated early-return): barrier for CodeQL.
    if (resolved.startsWith(rootPrefix)) {
      if (!existsSync(resolved)) {
        return undefined;
      }
      return resolved;
    }
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

type ChromiumLaunchOptions = {
  executablePath?: string;
  userDataDir?: string;
  [key: string]: unknown;
};

function getChromiumLaunchOptions(
  overrideExecutable: string | undefined,
  base: ChromiumLaunchOptions = {},
): ChromiumLaunchOptions {
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
 * Tell `puppeteer-extra-plugin-stealth` which profile to write into.
 *
 * Without `userDataDir` the plugin's bundled `user-data-dir` plugin mkdtemps a
 * `puppeteer_dev_profile-*` directory on every launch and only deletes it when
 * the browser disconnects gracefully — which never happens for a service that
 * is `SIGKILL`ed, so the directories pile up. Playwright itself ignores the
 * key (the profile comes from the positional argument), so passing it only
 * redirects the plugin's writes to the profile we already own.
 */
function withOwnedUserDataDir<T extends ChromiumLaunchOptions>(
  launchOpts: T,
  userDataDir: string,
): T & { userDataDir: string } {
  return { ...launchOpts, userDataDir };
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

  const baseOptions = { ...options };
  const existingArgs = Array.isArray(baseOptions.args)
    ? [...(baseOptions.args as string[])]
    : [];
  if (!existingArgs.includes("--disable-gpu")) {
    existingArgs.push("--disable-gpu");
  }
  baseOptions.args = existingArgs;

  const launchOpts = getChromiumLaunchOptions(
    typeof baseOptions.executablePath === "string"
      ? baseOptions.executablePath
      : undefined,
    baseOptions,
  );
  const maxRetries = 3;
  const baseRetryDelayMs = 500;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await launchWithFallback(
        () =>
          chromium.launchPersistentContext(
            userDataDir,
            withOwnedUserDataDir(launchOpts, userDataDir),
          ),
        () =>
          playwright.chromium.launchPersistentContext(userDataDir, launchOpts),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(message);

      if (/ProcessSingleton|SingletonLock/i.test(message)) {
        const tmpDir = createTemporaryDirectory(
          PLAYWRIGHT_FALLBACK_TEMPORARY_DIRECTORY_PREFIX,
        );
        try {
          cleanupChromiumLockFiles(tmpDir);
          console.warn(
            "[WARN] userDataDir locked, retrying with temp dir",
            tmpDir,
          );
          const fallbackContext = await launchWithFallback(
            () =>
              chromium.launchPersistentContext(
                tmpDir,
                withOwnedUserDataDir(launchOpts, tmpDir),
              ),
            () =>
              playwright.chromium.launchPersistentContext(tmpDir, launchOpts),
          );
          fallbackContext.on("close", () => {
            removeTemporaryDirectory(tmpDir);
          });
          return fallbackContext;
        } catch {
          // Never leave the fallback profile behind when the launch fails.
          removeTemporaryDirectory(tmpDir);
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

/**
 * Keep the game window painting while it is backgrounded or occluded.
 *
 * The session runs as a Chromium `--app` window that OBS captures. When the
 * window manager reports it occluded (or the page is otherwise backgrounded)
 * Chromium throttles its timers and `requestAnimationFrame` down to a frame or
 * two per second, so the game renders at a crawl and the stream's picture
 * looks frozen even though the page keeps answering. These flags pin the
 * renderer to full speed regardless of window visibility.
 */
export const GAME_BROWSER_ANTI_THROTTLE_FLAGS = [
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-frame-rate-limit",
] as const;

export const create = async (
  executablePath?: string,
  viewport: ViewportSize = {
    width: 1280,
    height: 720,
  },
): Promise<
  Browser & {
    reload: () => Promise<void>;
    /** JPEG bytes of the current viewport (quality 100), used by the game-stall watchdog. */
    screenshot: () => Promise<Uint8Array>;
  }
> => {
  const launchTimeout = Number.parseInt(
    process.env.CHROMIUM_LAUNCH_TIMEOUT ?? "60000",
    10,
  );
  const evaluateTimeoutMs = resolveEvaluateTimeoutMs();
  const gameHomeUrl =
    process.env.GAME_HOME_URL?.trim() ||
    "https://www.nahcnuj.work/vigilant-fiesta/";

  const userDataDir = createTemporaryDirectory(
    GAME_BROWSER_TEMPORARY_DIRECTORY_PREFIX,
  );
  mkdirSync(join(userDataDir, "Default"), { recursive: true });
  writeFileSync(
    join(userDataDir, "Default", "Preferences"),
    JSON.stringify({
      translate: { enabled: false },
      browser: { translate: { enabled: false } },
    }),
    { mode: 0o600 },
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
      ...GAME_BROWSER_ANTI_THROTTLE_FLAGS,
      `--app=${gameHomeUrl}`,
    ],
  };

  // Drop undefined executablePath for Playwright
  if (!launchOpts.executablePath) {
    delete (launchOpts as { executablePath?: string }).executablePath;
  }

  const ctx = await chromium
    .launchPersistentContext(
      userDataDir,
      withOwnedUserDataDir(launchOpts, userDataDir),
    )
    .catch((err: unknown) => {
      // A failed launch must not leave the profile behind: the supervisor
      // relaunches this session in a loop, and each attempt would add one.
      removeTemporaryDirectory(userDataDir);
      throw err;
    });

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
  const dismissCloseButtonsInterval = setInterval(() => {
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

  let closed = false;

  return {
    open: async (url: string) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    close: async () => {
      // Idempotent: the session closes the browser from both its normal exit
      // path and its signal handler, and a second `ctx.close()` would throw.
      if (closed) return;
      closed = true;
      clearInterval(dismissCloseButtonsInterval);
      await ctx.close();
      removeTemporaryDirectory(userDataDir);
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
      return await withTimeout(
        page.evaluate((fnSource) => {
          // Reconstruct the function in the page context from its source string.
          // biome-ignore lint/security/noGlobalEval: required to run caller fn in page.evaluate
          const evaluated = globalThis.eval(`(${fnSource})`) as (
            document: Document,
          ) => ReturnType<typeof f>;
          return evaluated(document);
        }, f.toString()),
        evaluateTimeoutMs,
      );
    },

    reload: async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
    },

    // A wedged compositor makes `page.screenshot` hang, which would stall the
    // game-stall watchdog for the duration of Playwright's own timeout; bound
    // it like `evaluate` so the watchdog sees a catchable error instead.
    screenshot: async () =>
      await withTimeout(
        page.screenshot({ type: "jpeg", quality: 100 }),
        evaluateTimeoutMs,
        "browser.screenshot",
      ),
    get url() {
      return page.url();
    },
  } as Browser & {
    reload: () => Promise<void>;
    screenshot: () => Promise<Uint8Array>;
  };
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
