import { existsSync, mkdirSync, statSync } from "node:fs";
import {
  DEFAULT_FALLBACK_WATCH_URL,
  DEFAULT_WATCH_PAGE_BASE_URL,
  NICONAMA_USER_AGENT,
  type NiconamaLaunchPersistentContext,
} from "./types";
import { addNiconamaPlaywrightInitScript } from "../niconamaCommentClient.playwright";
import { extractWatchUrlFromHtml } from "../niconamaCommentClient.helpers";

/**
 * ニコ生の視聴URLを解決するモジュール。
 *
 * 設定されたURLが視聴ページURLでない場合（ユーザーURLやトップページなど）、
 * 実際に放送中の視聴URLへ解決する。
 */
export class WatchUrlResolver {
  readonly #watchUrl?: string;
  readonly #executablePath?: string;
  readonly #launchPersistentContext: NiconamaLaunchPersistentContext;
  readonly #userDataDir: string;

  constructor(options: {
    watchUrl?: string;
    executablePath?: string;
    launchPersistentContext: NiconamaLaunchPersistentContext;
    userDataDir: string;
  }) {
    this.#watchUrl = options.watchUrl;
    this.#executablePath = options.executablePath;
    this.#launchPersistentContext = options.launchPersistentContext;
    this.#userDataDir = options.userDataDir;
  }

  /**
   * 有効な視聴URLを解決して返す。解決できない場合はnullを返す。
   */
  async resolve(): Promise<string | null> {
    const candidateUrl =
      this.#watchUrl ??
      process.env.NICONAMA_WATCH_URL ??
      DEFAULT_WATCH_PAGE_BASE_URL;

    // 既に /watch/ を含むURLはそのまま使用
    if (/\/watch\//.test(candidateUrl)) {
      return candidateUrl;
    }

    const normalizedRootUrl = DEFAULT_WATCH_PAGE_BASE_URL.replace(/\/+$/u, "");
    const normalizedCandidateUrl = candidateUrl.replace(/\/+$/u, "");

    // トップページの場合はPlaywrightで視聴URLを探す
    if (normalizedCandidateUrl === normalizedRootUrl) {
      const watchUrl = await this.#resolveFromTopPage();
      if (watchUrl) {
        return watchUrl;
      }
    }

    // その他のURLはHTMLから視聴URLを抽出
    console.debug(
      "[DEBUG] WatchUrlResolver fetching candidate page",
      candidateUrl,
    );
    try {
      const html = await fetchHtml(candidateUrl);
      const watchUrl = extractWatchUrlFromHtml(html, candidateUrl);
      if (!watchUrl) {
        console.warn(
          "[WARN] WatchUrlResolver: failed to resolve watch URL from HTML",
          candidateUrl,
        );
        console.info(
          "[INFO] WatchUrlResolver: falling back to fixed NicoNico watch URL",
          DEFAULT_FALLBACK_WATCH_URL,
        );
        return DEFAULT_FALLBACK_WATCH_URL;
      }
      return watchUrl;
    } catch (err) {
      console.warn("[WARN] WatchUrlResolver: fetch failed", err);
      console.info(
        "[INFO] WatchUrlResolver: falling back to fixed NicoNico watch URL",
        DEFAULT_FALLBACK_WATCH_URL,
      );
      return DEFAULT_FALLBACK_WATCH_URL;
    }
  }

  /**
   * ニコ生トップページをPlaywrightで開き、「馬可無序」の放送中URLを取得する。
   */
  async #resolveFromTopPage(): Promise<string | null> {
    console.debug(
      "[DEBUG] WatchUrlResolver: opening Niconama top page via Playwright",
      DEFAULT_WATCH_PAGE_BASE_URL,
    );

    ensureUserDataDirExists(this.#userDataDir);

    let context: Awaited<ReturnType<NiconamaLaunchPersistentContext>>;
    try {
      context = await this.#launchPersistentContext(this.#userDataDir, {
        executablePath: this.#executablePath,
        headless: true,
        ignoreHTTPSErrors: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    } catch (launchErr) {
      const errMsg =
        launchErr instanceof Error ? launchErr.message : String(launchErr);
      console.error(
        "[ERROR] WatchUrlResolver: failed to launch context:",
        errMsg,
      );
      console.info(
        "[INFO] WatchUrlResolver: falling back to fixed watch URL",
        DEFAULT_FALLBACK_WATCH_URL,
      );
      return DEFAULT_FALLBACK_WATCH_URL;
    }

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await addNiconamaPlaywrightInitScript(page);
      await page.goto(DEFAULT_WATCH_PAGE_BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      const targetLocator = page.getByText("馬可無序");
      if ((await targetLocator.count()) === 0) {
        console.info(
          "[INFO] WatchUrlResolver: 馬可無序 not found on top page; falling back",
          DEFAULT_FALLBACK_WATCH_URL,
        );
        return DEFAULT_FALLBACK_WATCH_URL;
      }
      const target = targetLocator.first();
      try {
        await target.waitFor({ state: "visible", timeout: 15_000 });
        await target.hover({ timeout: 15_000 });
      } catch (hoverErr) {
        console.warn("[WARN] WatchUrlResolver: hover failed", hoverErr);
      }
      await page.waitForTimeout(1_500);

      const broadcastLink = page
        .locator('a:has-text("放送中のページ")')
        .first();
      if ((await broadcastLink.count()) > 0) {
        const href = await broadcastLink.getAttribute("href");
        if (href) {
          return new URL(href, DEFAULT_WATCH_PAGE_BASE_URL).href;
        }
      }

      console.warn(
        "[WARN] WatchUrlResolver: failed to resolve via Playwright",
        DEFAULT_WATCH_PAGE_BASE_URL,
      );
      console.info(
        "[INFO] WatchUrlResolver: falling back to fixed watch URL",
        DEFAULT_FALLBACK_WATCH_URL,
      );
      return DEFAULT_FALLBACK_WATCH_URL;
    } finally {
      await context.close();
    }
  }
}

/** userDataDirが存在することを保証する */
export const ensureUserDataDirExists = (userDataDir: string): void => {
  if (existsSync(userDataDir)) {
    if (!statSync(userDataDir).isDirectory()) {
      throw new Error(`userDataDir must be a directory: ${userDataDir}`);
    }
    return;
  }
  mkdirSync(userDataDir, { recursive: true });
};

/**
 * 指定URLからHTMLを取得する。失敗時はリトライする。
 */
export const fetchHtml = async (url: string): Promise<string> => {
  const maxAttempts = 5;
  let lastErr: unknown = null;

  const getBackoffMs = (attempt: number): number =>
    Math.min(10_000, 300 * 2 ** (attempt - 1));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent": NICONAMA_USER_AGENT,
        },
      });

      if (response.ok) {
        const text = await response.text();
        console.debug("[DEBUG] fetchHtml fetched", {
          url,
          length: text.length,
        });
        return text;
      }

      if (response.status === 405) {
        if (attempt < maxAttempts) {
          const delayMs = getBackoffMs(attempt);
          console.warn(
            "[WARN] fetchHtml received 405 WAF/captcha, retrying after backoff",
            { url, attempt, delayMs },
          );
          await new Promise((res) => setTimeout(res, delayMs));
          continue;
        }
        const text405 = await response.text().catch(() => null);
        console.warn(
          "[WARN] fetchHtml received 405 WAF/captcha, returning body for fallback",
        );
        return text405 ?? "";
      }

      if (
        response.status >= 500 &&
        response.status < 600 &&
        attempt < maxAttempts
      ) {
        lastErr = new Error(`server error ${response.status}`);
        const delayMs = getBackoffMs(attempt);
        console.warn(
          "[WARN] fetchHtml server error, retrying after backoff",
          { url, status: response.status, attempt, delayMs },
        );
        await new Promise((res) => setTimeout(res, delayMs));
        continue;
      }
      throw new Error(`failed to fetch ${url}: ${response.status}`);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delayMs = getBackoffMs(attempt);
        console.warn(
          "[WARN] fetchHtml request failed, retrying after backoff",
          { url, attempt, delayMs, error: err },
        );
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }

  if (lastErr) {
    console.warn(
      "[WARN] fetchHtml: all attempts failed",
      lastErr instanceof Error ? lastErr.message : String(lastErr),
    );
  }
  return "";
};
