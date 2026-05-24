import { existsSync, mkdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentComment } from "automated-gameplay-transmitter";
import { DEFAULT_PLAYWRIGHT_USER_DATA_DIR, DEFAULT_CHROMIUM_EXECUTABLE_PATH, launchPersistentContext } from "./Browser/chromium";

const DEFAULT_POLL_INTERVAL_MS = 30_000;
export const DEFAULT_WATCH_PAGE_BASE_URL = 'https://live.nicovideo.jp/';
export const DEFAULT_FALLBACK_WATCH_URL = 'https://live.nicovideo.jp/watch/user/14171889';

/**
 * `userDataDir` が存在しない場合はディレクトリを作成する。
 * パスが存在するがディレクトリでない場合はエラーをスローする。
 */
export const ensureUserDataDirExists = (userDataDir: string): void => {
  if (existsSync(userDataDir)) {
    if (!statSync(userDataDir).isDirectory()) {
      throw new Error(`userDataDir must be a directory: ${userDataDir}`);
    }
    return;
  }

  mkdirSync(userDataDir, { recursive: true });
};

export const normalizeHtmlForUrlExtraction = (html: string): string =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x27;/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'");

export const extractWatchUrlFromHtml = (html: string, baseUrl: string): string | null => {
  const normalizedHtml = normalizeHtmlForUrlExtraction(html);
  const patterns = [
    /["'](https?:\/\/(?:ext\.)?live\.nicovideo\.jp\/watch\/(?:lv|user)[^"']+)["']/i,
    /["'](\/watch\/(?:lv|user)[^"']+)["']/i,
    /watchPageUrl[^"']*["']([^"']*\/watch\/(?:lv|user)[^"']*)["']/i,
    /programWatchPageUrl[^"']*["']([^"']*\/watch\/(?:lv|user)[^"']*)["']/i,
    /watchPageUrlAtExtPlayer[^"']*["']([^"']*\/watch\/(?:lv|user)[^"']*)["']/i,
  ] as const;

  for (const pattern of patterns) {
    const match = normalizedHtml.match(pattern);
    if (!match) continue;
    try {
      return new URL(match[1]!, baseUrl).href;
    } catch {
      continue;
    }
  }

  return null;
};

export const tryParseJson = (text: string): unknown | null => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const buildNiconamaStreamStateFromStatisticsEvent = (body: unknown): unknown | null => {
  if (!body || typeof body !== 'object') return null;
  if ((body as any).type !== 'statistics') return null;

  const data = (body as any).data;
  if (!data || typeof data !== 'object') return null;

  const listeners = typeof data.viewers === 'number' ? data.viewers : undefined;
  const comments = typeof data.comments === 'number' ? data.comments : undefined;
  const adPoints = typeof data.adPoints === 'number' ? data.adPoints : undefined;
  const giftPoints = typeof data.giftPoints === 'number' ? data.giftPoints : undefined;

  if (listeners === undefined && comments === undefined && adPoints === undefined && giftPoints === undefined) {
    return null;
  }

  const streamState: Record<string, unknown> = {};
  const total: Record<string, number> = {};

  if (listeners !== undefined) total.listeners = listeners;
  if (adPoints !== undefined) total.ad = adPoints;
  if (giftPoints !== undefined) total.gift = giftPoints;

  if (Object.keys(total).length > 0) {
    streamState.niconama = {
      type: 'live',
      meta: { total },
    };
  }

  if (comments !== undefined) {
    streamState.commentCount = comments;
  }

  return Object.keys(streamState).length > 0 ? streamState : null;
};

export const extractEmbeddedDataFromHtml = (html: string): unknown | null => {
  const findEmbeddedDataOpenTag = (input: string): string | null => {
    let searchIndex = 0;
    while (true) {
      const openIndex = input.indexOf('<', searchIndex);
      if (openIndex === -1) return null;

      const tagNameMatch = /^[ \t\n\r]*([A-Za-z]+)/.exec(input.slice(openIndex + 1));
      if (!tagNameMatch) {
        searchIndex = openIndex + 1;
        continue;
      }

      const tagName = tagNameMatch[1]!.toLowerCase();
      if (tagName !== 'script' && tagName !== 'div') {
        searchIndex = openIndex + 1;
        continue;
      }

      let cursor = openIndex + 1 + tagNameMatch[0].length;
      let quoteChar: string | null = null;
      while (cursor < input.length) {
        const char = input[cursor];
        if (quoteChar) {
          if (char === quoteChar) {
            quoteChar = null;
          }
        } else if (char === '"' || char === "'") {
          quoteChar = char;
        } else if (char === '>') {
          break;
        }
        cursor += 1;
      }

      if (cursor >= input.length) return null;

      const openTag = input.slice(openIndex, cursor + 1);
      if (/\bid\s*=\s*(['"])embedded-data\1/i.test(openTag)) {
        return openTag;
      }

      searchIndex = cursor + 1;
    }
  };

  const extractDataPropsValue = (openTag: string): string | null => {
    let searchIndex = 0;
    const lowerTag = openTag.toLowerCase();
    while (true) {
      const dpIndex = lowerTag.indexOf('data-props=', searchIndex);
      if (dpIndex === -1) return null;

      let cursor = dpIndex + 'data-props='.length;
      while (cursor < openTag.length && /\s/.test(openTag[cursor]!)) cursor += 1;
      const quote = openTag[cursor];
      if (quote !== '"' && quote !== "'") {
        searchIndex = cursor;
        continue;
      }

      const valueStart = cursor + 1;
      let valueEnd = valueStart;
      while (valueEnd < openTag.length) {
        const char = openTag[valueEnd];
        if (char === quote) {
          return openTag.slice(valueStart, valueEnd);
        }
        if (char === '\\' && valueEnd + 1 < openTag.length) {
          valueEnd += 2;
          continue;
        }
        valueEnd += 1;
      }
      return null;
    }
  };

  const parseJsonFromRaw = (raw: string): unknown | null => {
    const normalized = normalizeHtmlForUrlExtraction(raw);
    const parsed = tryParseJson(normalized);
    if (parsed) return parsed;
    try {
      JSON.parse(normalized);
    } catch (err) {
      console.info('[INFO] JSON.parse failed for extracted data-props', {
        err: String(err),
        snippet: normalized.slice(0, 400),
      });
    }
    return null;
  };

  const openTag = findEmbeddedDataOpenTag(html);
  if (openTag) {
    console.info('[INFO] extractEmbeddedDataFromHtml openTag', openTag.slice(0, 400));
    console.info('[DEBUG] extractEmbeddedDataFromHtml openTag length', openTag.length);
    console.info('[DEBUG] extractEmbeddedDataFromHtml openTag tail', openTag.slice(-200));
    console.info('[DEBUG] extractEmbeddedDataFromHtml html length', html.length);
    console.info('[DEBUG] extractEmbeddedDataFromHtml html tail', html.slice(-200));

    const rawDataProps = extractDataPropsValue(openTag);
    if (rawDataProps) {
      console.info('[DEBUG] extractEmbeddedDataFromHtml raw data-props length', rawDataProps.length);
      const parsed = parseJsonFromRaw(rawDataProps);
      if (parsed) return parsed;
    }
  }

  const attrMatch = html.match(/data-props=(['"])([\s\S]*?)\1/i);
  if (attrMatch && attrMatch[2]) {
    console.info('[INFO] extractEmbeddedDataFromHtml raw data-props snippet', attrMatch[2].slice(0, 200));
    console.info('[DEBUG] extractEmbeddedDataFromHtml raw length', attrMatch[2].length);
    console.info('[DEBUG] extractEmbeddedDataFromHtml raw tail', attrMatch[2].slice(-40));
    const parsed = parseJsonFromRaw(attrMatch[2]!);
    if (parsed) return parsed;
  }

  const innerMatch = html.match(/<(?:div|script)[^>]*id=['"]embedded-data['"][^>]*>([\s\S]*?)<\/(?:div|script)>/i);
  if (innerMatch && innerMatch[1]) {
    const parsed = parseJsonFromRaw(innerMatch[1]!);
    if (parsed) return parsed;
  }

  return null;
};

type NiconamaBrowserPageResponse = {
  status: () => number;
  text: () => Promise<string>;
};

type NiconamaBrowserPage = {
  on: (event: string, callback: any) => void;
  goto: (url: string, options?: Record<string, unknown>) => Promise<NiconamaBrowserPageResponse | null>;
  close: () => Promise<void>;
  evaluate: <T>(pageFunction: () => T) => Promise<T>;
  getByText: (text: string) => {
    count: () => Promise<number>;
    first: () => {
      hover: (options?: { timeout?: number }) => Promise<void>;
      waitFor: (options: Record<string, unknown>) => Promise<void>;
      count: () => Promise<number>;
    };
  };
  locator: (selector: string) => {
    first: () => {
      getAttribute: (name: string) => Promise<string | null>;
      count: () => Promise<number>;
    };
  };
  waitFor: (options: Record<string, unknown>) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForLoadState?: (state?: string, options?: Record<string, unknown>) => Promise<void>;
  waitForSelector?: (selector: string, options?: Record<string, unknown>) => Promise<unknown>;
  url: () => string;
  isClosed: () => boolean;
};

type NiconamaBrowserContext = {
  pages: () => NiconamaBrowserPage[];
  newPage: () => Promise<NiconamaBrowserPage>;
  close: () => Promise<void>;
};

type NiconamaLaunchPersistentContext = (userDataDir: string, options?: Record<string, unknown>) => Promise<NiconamaBrowserContext>;

export type NiconamaCommentClientOptions = {
  userDataDir?: string;
  executablePath?: string;
  watchUrl?: string;
  pollIntervalMs?: number;
  launchPersistentContext?: NiconamaLaunchPersistentContext;
};

type NiconamaCommentClientCallbacks = {
  onComments: (comments: AgentComment[]) => void;
  onMeta: (state: unknown) => void;
  onError?: (error: unknown) => void;
};

export class NiconamaCommentClient {
  #userDataDir: string;
  #watchUrl?: string;
  #executablePath?: string;
  #pollIntervalMs: number;
  #running = false;
  #stopRequested = false;
  #pollTask: Promise<void> | null = null;
  #seenCommentIdentifiers = new Set<string>();
  #directWebSocket: any | null = null;
  #directWebSocketKeepSeatTimer: ReturnType<typeof setInterval> | null = null;
  #playwrightCommentContext: any | null = null;
  #playwrightCommentPage: any | null = null;
  #playwrightPageCommentPollTimer: ReturnType<typeof setInterval> | null = null;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #pollCancelResolve: (() => void) | null = null;
  #launchPersistentContext: NiconamaLaunchPersistentContext;
  #callbacks: NiconamaCommentClientCallbacks;

  constructor(options: NiconamaCommentClientOptions, callbacks: NiconamaCommentClientCallbacks) {
    this.#userDataDir = options.userDataDir ?? DEFAULT_PLAYWRIGHT_USER_DATA_DIR;
    this.#watchUrl = options.watchUrl;
    this.#executablePath = options.executablePath ?? DEFAULT_CHROMIUM_EXECUTABLE_PATH;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#launchPersistentContext = options.launchPersistentContext ?? (launchPersistentContext as unknown as NiconamaLaunchPersistentContext);
    this.#callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#stopRequested = false;

    console.debug('[DEBUG] NiconamaCommentClient start()', {
      userDataDir: this.#userDataDir,
      watchUrl: this.#watchUrl,
      pollIntervalMs: this.#pollIntervalMs,
    });

    ensureUserDataDirExists(this.#userDataDir);
    const watchUrl = await this.resolveWatchUrl();
    if (!watchUrl) {
      this.reportError(new Error('failed to resolve NicoNico watch URL'));
      return;
    }

    const embeddedData = await this.fetchEmbeddedData(watchUrl);
    console.debug('[DEBUG] NiconamaCommentClient fetched embedded-data in start', {
      embeddedDataType: embeddedData === null ? 'null' : typeof embeddedData,
      hasWebSocketUrl: embeddedData && typeof embeddedData === 'object'
        ? Boolean((embeddedData as any).site?.state?.relive?.webSocketUrl ?? (embeddedData as any).site?.relive?.webSocketUrl ?? (embeddedData as any).relive?.webSocketUrl)
        : false,
    });
    if (!embeddedData || typeof embeddedData !== 'object') {
      this.reportError(new Error(`failed to resolve embedded-data from NicoNico watch page: ${watchUrl}`));
      return;
    }

    // If the program has already ended, skip the live-meta emission and
    // watcher setup and go straight into the poll loop.
    if ((embeddedData as any).programEnded) {
      this.#running = true;
      this.#pollTask = this.pollLoop();
      return;
    }

    this.#running = true;
    this.#callbacks.onMeta({
      type: 'niconama',
      data: {
        isLive: true,
        title: 'NicoNico Live',
        startTime: Date.now(),
        total: 0,
        points: { gift: 0, ad: 0 },
        url: watchUrl,
      },
    });

    await this.setupDirectWebSocketConnection(watchUrl, embeddedData);
    if (!this.#directWebSocket) {
      await this.setupPlaywrightCommentWatcher(watchUrl);
    }
    // After watchers are installed, perform an immediate re-scan to catch any
    // comments that arrived between the initial embedded-data fetch and the
    // watcher installation. `seenCommentIdentifiers` prevents duplicates.
    await this.performImmediateRescan(watchUrl).catch(() => undefined);
    this.#pollTask = this.pollLoop();
    console.info('[DEBUG] NiconamaCommentClient.start finished');
  }

  public async fetchEmbeddedData(watchUrl?: string): Promise<unknown | null> {
    const targetUrl = watchUrl ?? this.#watchUrl ?? DEFAULT_FALLBACK_WATCH_URL;
    // Try fetching the page HTML first (fast, no browser required)
    const embedded = await this.fetchEmbeddedDataFromPage(targetUrl);
    // If the earlier fetch returned a sentinel indicating the program has
    // ended, treat that as a valid result so the client can continue
    // operating (e.g. start polling for the next program) instead of
    // aborting startup.
    if (embedded && typeof embedded === 'object' && (embedded as any).programEnded) {
      return embedded;
    }

    if (embedded) {
      const commentCount = typeof (embedded as any).program?.statistics?.commentCount === 'number'
        ? (embedded as any).program.statistics.commentCount
        : undefined;
      const initialComments = parseAgentCommentsFromResponseBody(embedded);
      const embeddedWebSocketUrl = this.getWebSocketUrlFromEmbeddedData(embedded);

      if (embeddedWebSocketUrl || initialComments.length > 0) {
        return embedded;
      }

      console.debug('[DEBUG] fetchEmbeddedData found embedded-data without websocket URL, falling back to Playwright', targetUrl, {
        commentCount,
        initialCommentsCount: initialComments.length,
        embeddedWebSocketUrl: Boolean(embeddedWebSocketUrl),
      });

      const enrichedEmbedded = await this.fetchEmbeddedDataWithPlaywright(targetUrl, embedded);
      return enrichedEmbedded ?? embedded;
    }

    const renderedEmbedded = await this.fetchEmbeddedDataWithPlaywright(targetUrl);
    return renderedEmbedded;
  }

  public async fetchRenderedWatchPageBodyText(watchUrl?: string): Promise<string | null> {
    const targetUrl = watchUrl ?? this.#watchUrl ?? DEFAULT_FALLBACK_WATCH_URL;
    const staticHtml = await this.fetchHtml(targetUrl).catch(() => null);
    if (typeof staticHtml === 'string') {
      const staticBodyText = this.extractBodyTextFromHtml(staticHtml);
      if (staticBodyText) {
        return staticBodyText;
      }
    }

    const tempUserDataDir = mkdtempSync(join(tmpdir(), 'niconama-body-text-'));
    let context: any = null;

    try {
      context = await this.#launchPersistentContext(tempUserDataDir, {
        executablePath: this.#executablePath,
        headless: true,
        ignoreHTTPSErrors: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale: 'ja-JP',
      });

      const page = await context.newPage();
      const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      if (!response || response.status() >= 400) {
        console.warn('[WARN] fetchRenderedWatchPageBodyText failed to navigate', { targetUrl, status: response?.status?.() });
        return null;
      }

      const activePages = context.pages().filter((p: any) => !p.isClosed());
      for (const currentPage of activePages) {
        if (currentPage.isClosed()) continue;
        const bodyText = await this.getBodyTextFromPage(currentPage);
        if (bodyText) {
          return bodyText;
        }
      }

      for (const currentPage of activePages) {
        if (currentPage.isClosed()) continue;
        try {
          await currentPage.waitForTimeout(2_000).catch(() => undefined);
          await currentPage.waitForLoadState?.('networkidle', { timeout: 10_000 }).catch(() => undefined);
        } catch {
          // ignore
        }
        const bodyText = await this.getBodyTextFromPage(currentPage);
        if (bodyText) {
          return bodyText;
        }
      }

      return null;
    } catch (err) {
      this.reportError(err);
      return null;
    } finally {
      if (context) {
        await context.close().catch(() => undefined);
      }
      rmSync(tempUserDataDir, { recursive: true, force: true });
    }
  }

  private async getBodyTextFromPage(page: any): Promise<string | null> {
    if (typeof page.isClosed === 'function' && page.isClosed()) {
      return null;
    }

    try {
      const locator = page.locator?.('body');
      if (locator && typeof locator.allTextContents === 'function') {
        const contents = await locator.allTextContents();
        if (Array.isArray(contents) && contents.length > 0) {
          return contents.join('');
        }
      }
    } catch (err) {
      console.debug('[DEBUG] getBodyTextFromPage locator.allTextContents failed', err);
    }

    try {
      if (typeof page.evaluate === 'function') {
        const bodyText = await page.evaluate(() => document.body?.textContent ?? null);
        return typeof bodyText === 'string' ? bodyText : null;
      }
    } catch (err) {
      console.debug('[DEBUG] getBodyTextFromPage page.evaluate failed', err);
    }

    return null;
  }

  private extractBodyTextFromHtml(html: string): string | null {
    const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
    const source = bodyMatch?.[1] ?? html;
    const withoutScripts = source.replace(/<script[\s\S]*?<\/script>/gi, '');
    const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, '');
    const text = withoutStyles
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > 0 ? text : null;
  }

  async stop(): Promise<void> {
    this.#stopRequested = true;
    console.info('[DEBUG] NiconamaCommentClient.stop entered');
    // Give the poll loop a tick to ensure any sleep timer is installed,
    // then cancel it so stop() can resolve promptly instead of waiting
    // the full poll interval.
    if (this.#pollTask) {
      console.info('[DEBUG] NiconamaCommentClient.stop yielding to event loop before cancelling poll');
      await new Promise((res) => globalThis.setTimeout(res, 0));
    }

    // Cancel any in-flight poll sleep so stop() can resolve quickly.
    try {
      console.info('[DEBUG] NiconamaCommentClient.stop cancelling pollTimer/promise', { pollTimer: Boolean(this.#pollTimer), hasCancel: Boolean(this.#pollCancelResolve) });
      if (this.#pollTimer) {
        clearTimeout(this.#pollTimer as any);
        this.#pollTimer = null;
      }
      if (this.#pollCancelResolve) {
        const r = this.#pollCancelResolve;
        this.#pollCancelResolve = null;
        r();
      }
    } catch (e) {
      console.info('[WARN] NiconamaCommentClient.stop cancel error', e);
    }

    if (this.#pollTask) {
      console.info('[DEBUG] NiconamaCommentClient.stop not awaiting pollTask, will clear reference');
      this.#pollTask = null;
    }
    this.clearDirectWebSocket();
    await this.clearPlaywrightCommentWatcher();
    this.#running = false;
    console.info('[DEBUG] NiconamaCommentClient.stop finished');
  }

  isRunning(): boolean {
    return this.#running;
  }

  private async resolveWatchUrl(): Promise<string | null> {
    const candidateUrl = this.#watchUrl ?? process.env.NICONAMA_WATCH_URL ?? DEFAULT_WATCH_PAGE_BASE_URL;
    if (/\/watch\//.test(candidateUrl)) {
      return candidateUrl;
    }

    const normalizedRootUrl = DEFAULT_WATCH_PAGE_BASE_URL.replace(/\/+$/u, '');
    const normalizedCandidateUrl = candidateUrl.replace(/\/+$/u, '');
    if (normalizedCandidateUrl === normalizedRootUrl) {
      const watchUrl = await this.resolveWatchUrlFromNiconamaTopPage();
      if (watchUrl) {
        return watchUrl;
      }
    }

    console.debug('[DEBUG] resolveWatchUrl fetching candidate page', candidateUrl);
    try {
      const html = await this.fetchHtml(candidateUrl);
      const watchUrl = extractWatchUrlFromHtml(html, candidateUrl);
      if (!watchUrl) {
        console.warn('[WARN] failed to resolve watch URL from HTML', candidateUrl);
        console.info('[INFO] falling back to fixed NicoNico watch URL', DEFAULT_FALLBACK_WATCH_URL);
        return DEFAULT_FALLBACK_WATCH_URL;
      }
      return watchUrl;
    } catch (err) {
      this.reportError(err);
      console.info('[INFO] falling back to fixed NicoNico watch URL', DEFAULT_FALLBACK_WATCH_URL);
      return DEFAULT_FALLBACK_WATCH_URL;
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    const maxAttempts = 3;
    let lastErr: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': userAgent,
          },
        });

        if (response.ok) {
          const text = await response.text();
          console.debug('[DEBUG] fetchHtml fetched', { url, length: text.length });
          return text;
        }

        // Retry on server errors (5xx)
        if (response.status >= 500 && response.status < 600 && attempt < maxAttempts) {
          lastErr = new Error(`server error ${response.status}`);
          // exponential-ish backoff
          await new Promise((res) => setTimeout(res, 200 * attempt));
          continue;
        }

        throw new Error(`failed to fetch ${url}: ${response.status}`);
      } catch (err) {
        lastErr = err;
        // If this was the last attempt, rethrow below; otherwise wait and retry.
        if (attempt < maxAttempts) {
          await new Promise((res) => setTimeout(res, 200 * attempt));
          continue;
        }
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('failed to fetch HTML');
  }

  private async resolveWatchUrlFromNiconamaTopPage(): Promise<string | null> {
    console.debug('[DEBUG] resolveWatchUrlWithPlaywright opening Niconama top page', DEFAULT_WATCH_PAGE_BASE_URL);
    const context = await this.#launchPersistentContext(this.#userDataDir, {
      executablePath: this.#executablePath,
      headless: true,
      ignoreHTTPSErrors: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(DEFAULT_WATCH_PAGE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 3_000 });
      const targetLocator = page.getByText('馬可無序');
      if (await targetLocator.count() === 0) {
        console.info('[INFO] 馬可無序 was not present on the top page; falling back to fixed watch URL', DEFAULT_FALLBACK_WATCH_URL);
        return DEFAULT_FALLBACK_WATCH_URL;
      }
      const target = targetLocator.first();
      try {
        await target.waitFor({ state: 'visible', timeout: 15_000 });
        await target.hover({ timeout: 15_000 });
      } catch (hoverErr) {
        console.warn('[WARN] failed to hover target element', hoverErr);
      }
      await page.waitForTimeout(1_500);

      const broadcastLink = page.locator('a:has-text("放送中のページ")').first();
      if (await broadcastLink.count() > 0) {
        const href = await broadcastLink.getAttribute('href');
        if (href) {
          return new URL(href, DEFAULT_WATCH_PAGE_BASE_URL).href;
        }
      }

      console.warn('[WARN] failed to resolve watch URL via Playwright', DEFAULT_WATCH_PAGE_BASE_URL);
      console.info('[INFO] falling back to fixed NicoNico watch URL', DEFAULT_FALLBACK_WATCH_URL);
      return DEFAULT_FALLBACK_WATCH_URL;
    } finally {
      await context.close();
    }
  }

  private getWebSocketUrlFromEmbeddedData(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined;
    return (data as any).site?.state?.relive?.webSocketUrl ??
      (data as any).site?.relive?.webSocketUrl ??
      (data as any).relive?.webSocketUrl;
  }

  private async fetchEmbeddedDataWithPlaywright(targetUrl: string, existingEmbeddedData?: unknown): Promise<unknown | null> {
    try {
      console.debug('[DEBUG] fetchEmbeddedData falling back to Playwright', targetUrl);
      console.debug('[DEBUG] launching Playwright persistent context');
      const context = await this.#launchPersistentContext(this.#userDataDir, {
        executablePath: this.#executablePath,
        headless: true,
        ignoreHTTPSErrors: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale: 'ja-JP',
      });
      console.debug('[DEBUG] Playwright context launched');
      try {
        console.debug('[DEBUG] opening new Playwright page');
        const page = await context.newPage();
        console.debug('[DEBUG] page opened', { url: page.url(), isClosed: page.isClosed() });
        console.debug('[DEBUG] navigating to target URL');
        const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 });
        console.debug('[DEBUG] page goto complete', { responseStatus: response?.status(), url: page.url() });

        let parsed: unknown | null = null;
        if (response) {
          try {
            const html = await response.text();
            console.debug('[DEBUG] Playwright response HTML length', { length: html.length });
            const embeddedData = extractEmbeddedDataFromHtml(html);
            if (embeddedData) {
              parsed = embeddedData;
            }
          } catch (err) {
            console.warn('[WARN] failed to read Playwright navigation response text', err);
          }
        }

        const pageUrl = page.url();
        let immediateComments: AgentComment[] = [];
        if (!page.isClosed()) {
          await this.tryOpenRenderedCommentPanel(page);
          try {
            immediateComments = await this.extractPageComments(page);
            if (immediateComments.length > 0) {
              this.#callbacks.onComments(immediateComments);
              console.debug('[DEBUG] Playwright immediate page comments extracted', { count: immediateComments.length, url: pageUrl });
            }
          } catch (err) {
            console.debug('[DEBUG] Playwright immediate page comment extraction failed', err);
          }
        }

        if (!page.isClosed()) {
          try {
            await page.waitForTimeout(5_000);
          } catch (err) {
            console.warn('[WARN] Playwright waitForTimeout failed', err);
          }
        } else {
          console.warn('[WARN] Playwright page closed before timeout wait', { url: pageUrl });
        }
        console.debug('[DEBUG] Playwright page loaded, parsed embedded-data', { hasParsedData: Boolean(parsed), pageClosed: page.isClosed(), url: pageUrl });

        let pageComments: AgentComment[] = [];
        if (!page.isClosed()) {
          try {
            await page.waitForLoadState?.('networkidle', { timeout: 15_000 });
          } catch {
            console.debug('[DEBUG] Playwright page networkidle wait failed or timed out', { url: pageUrl });
          }
          pageComments = await this.pollPageComments(page, 1_000);
          if (pageComments.length > 0) {
            this.#callbacks.onComments(pageComments);
            console.debug('[DEBUG] Playwright page comments extracted', { count: pageComments.length, url: pageUrl });
          }
        } else {
          console.debug('[DEBUG] Skipping Playwright page comment extraction because page is closed', { url: pageUrl });
        }

        if (!page.isClosed()) {
          try {
            await page.waitForTimeout(5_000);
          } catch (err) {
            console.warn('[WARN] Playwright waitForTimeout failed', err);
          }
        }

        const allPageComments = [...immediateComments, ...pageComments];
        const commentObjects = allPageComments
          .map((comment) => {
            const commentText = typeof (comment as any).data?.comment === 'string' ? (comment as any).data.comment : undefined;
            return commentText ? { comment: commentText } : undefined;
          })
          .filter((item): item is { comment: string } => Boolean(item));

        let result = parsed ?? (existingEmbeddedData && typeof existingEmbeddedData === 'object' ? { ...(existingEmbeddedData as any) } : null);
        if (!result && commentObjects.length > 0) {
          result = { relive: { comments: commentObjects } };
        }

        if (commentObjects.length > 0 && result && typeof result === 'object') {
          const merged = result as any;
          if ((merged as any).site?.state?.relive) {
            merged.site.state.relive.comments = commentObjects;
          }
          if ((merged as any).site?.relive) {
            merged.site.relive.comments = commentObjects;
          }
          if ((merged as any).relive) {
            merged.relive.comments = commentObjects;
          }
        }

        if (!result) {
          console.debug('[DEBUG] Playwright fallback did not produce embedded-data, returning existing embedded', { targetUrl, hasParsedData: Boolean(parsed), commentObjectsCount: commentObjects.length });
          return null;
        }

        console.debug('[DEBUG] Playwright fallback returning enriched embedded-data', { targetUrl, commentObjectsCount: commentObjects.length });
        return result;
      } finally {
        await context.close();
      }
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  private async fetchEmbeddedDataFromPage(watchUrl: string): Promise<unknown | null> {
    try {
      const html = await this.fetchHtml(watchUrl);

      // If the watch page contains an explicit "公開終了" marker, notify
      // consumers via `onMeta` and return a sentinel object so callers can
      // continue operating (e.g. start polling) instead of aborting.
      try {
        if (typeof html === 'string' && html.includes('公開終了')) {
          try {
            this.#callbacks.onMeta({
              type: 'niconama',
              data: {
                isLive: false,
                title: '公開終了',
                startTime: Date.now(),
                total: 0,
                points: { gift: 0, ad: 0 },
                url: watchUrl,
              },
            });
          } catch (cbErr) {
            this.reportError(cbErr);
          }
          return { programEnded: true, url: watchUrl };
        }
      } catch (e) {
        // fall through to regular parsing on unexpected errors
        this.reportError(e);
      }

      const embeddedData = extractEmbeddedDataFromHtml(html);
      if (!embeddedData) {
        console.warn('[WARN] embedded-data element not found', watchUrl);
        return null;
      }
      return embeddedData;
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  private async setupDirectWebSocketConnection(watchUrl: string, embeddedData?: unknown): Promise<void> {
    if (this.#directWebSocket) return;

    console.debug('[DEBUG] setting up direct websocket connection', watchUrl);
    const data = embeddedData ?? await this.fetchEmbeddedDataFromPage(watchUrl);
    if (!data || typeof data !== 'object') {
      console.warn('[WARN] failed to parse embedded data from page', watchUrl);
      return;
    }

    const initialComments = parseAgentCommentsFromResponseBody(data, this.#seenCommentIdentifiers);
    if (initialComments.length > 0) {
      console.debug('[DEBUG] direct websocket initial comments from embedded data', { count: initialComments.length, watchUrl });
      this.#callbacks.onComments(initialComments);
    }

    const webSocketUrl = (data as any).site?.state?.relive?.webSocketUrl ?? (data as any).site?.relive?.webSocketUrl ?? (data as any).relive?.webSocketUrl;
    if (!webSocketUrl || typeof webSocketUrl !== 'string') {
      console.warn('[WARN] direct websocket url not found in embedded data', { embeddedData: data });
      return;
    }

    try {
      const WebSocketClass = (globalThis as any).WebSocket;
      if (typeof WebSocketClass !== 'function') {
        console.warn('[WARN] direct websocket not available in this runtime, skipping direct websocket connection', { watchUrl });
        return;
      }

      console.debug('[DEBUG] direct websocket creating socket', webSocketUrl);
      const ws = new WebSocketClass(webSocketUrl, { headers: { Origin: 'https://live.nicovideo.jp' } });
      this.#directWebSocket = ws;

      ws.onopen = () => {
        console.info('[INFO] direct websocket established', webSocketUrl);
        this.sendDirectWebSocketMessage({ type: 'keepSeat' });
      };

      ws.onmessage = (event: { data: unknown }) => {
        try {
          const payload = typeof event.data === 'string'
            ? event.data
            : event.data instanceof ArrayBuffer
              ? new TextDecoder().decode(event.data)
              : String(event.data);
          console.debug('[DEBUG] direct websocket received message', { wsUrl: webSocketUrl, payloadLength: payload.length });
          this.handleDirectWebSocketMessage(payload, webSocketUrl);
        } catch (err) {
          console.warn('[WARN] failed to handle direct websocket message', err);
        }
      };

      ws.onerror = (event: unknown) => {
        console.warn('[WARN] direct websocket error', event);
      };

      ws.onclose = (event: { code?: number; reason?: string }) => {
        console.warn('[WARN] direct websocket closed', webSocketUrl, event.code, event.reason);
        if (this.#directWebSocket === ws) {
          this.clearDirectWebSocket();
        }
        if (!this.#stopRequested) {
          globalThis.setTimeout(() => {
            if (!this.#stopRequested) {
              void this.setupDirectWebSocketConnection(watchUrl);
            }
          }, 5_000);
        }
      };

      this.#directWebSocketKeepSeatTimer = setInterval(() => {
        if (this.#directWebSocket && this.#directWebSocket.readyState === WebSocketClass.OPEN) {
          const keepSeatMessage = JSON.stringify({ type: 'keepSeat' });
          console.debug('[DEBUG] direct websocket sending message', keepSeatMessage);
          this.#directWebSocket.send(keepSeatMessage);
        }
      }, 10_000);
      console.info('[DEBUG] setupDirectWebSocketConnection finished');
    } catch (err) {
      this.reportError(err);
    }
  }

  private clearDirectWebSocket(): void {
    if (this.#directWebSocketKeepSeatTimer) {
      clearInterval(this.#directWebSocketKeepSeatTimer);
      this.#directWebSocketKeepSeatTimer = null;
    }
    if (!this.#directWebSocket) return;

    const ws = this.#directWebSocket;
    this.#directWebSocket = null;
    try {
      ws.close();
    } catch {
      // ignore
    }
  }

  private async setupPlaywrightCommentWatcher(watchUrl: string): Promise<void> {
    if (this.#playwrightCommentContext) return;

    try {
      console.debug('[DEBUG] starting Playwright comment watcher', watchUrl);
      const context = await this.#launchPersistentContext(this.#userDataDir, {
        executablePath: this.#executablePath,
        headless: true,
        ignoreHTTPSErrors: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale: 'ja-JP',
      });

      let page = await context.newPage();
      page.on('close', () => {
        console.debug('[DEBUG] Playwright page closed', { url: page.url() });
      });
      page.on('crash', () => {
        console.debug('[DEBUG] Playwright page crashed', { url: page.url() });
      });
      page.on('request', (request: any) => {
        const url = request.url();
        if (/comment|wsapi|watch|json|data/i.test(url)) {
          console.debug('[DEBUG] Playwright request', url);
        }
      });
      page.on('requestfailed', (request: any) => {
        const url = request.url();
        if (/comment|wsapi|watch|json|data/i.test(url)) {
          console.debug('[DEBUG] Playwright request failed', url, request.failure()?.errorText);
        }
      });
      page.on('websocket', (socket: any) => {
        const wsUrl = socket.url();
        console.debug('[DEBUG] Playwright websocket connected', wsUrl);
        socket.on('framereceived', (frame: any) => {
          let payload = frame.payload;
          if (payload instanceof ArrayBuffer) {
            payload = new TextDecoder().decode(payload);
          } else if (typeof payload !== 'string') {
            payload = String(payload);
          }
          console.debug('[DEBUG] Playwright websocket frame', {
            url: wsUrl,
            length: payload.length,
            snippet: payload.slice(0, 200),
          });
          this.handlePlaywrightWebSocketFrame(payload, wsUrl);
        });
      });

      page.on('response', async (response: any) => {
        const url = response.url();
        const contentType = (response.headers()['content-type'] ?? '').toLowerCase();

        let bodyText: string;
        try {
          bodyText = await response.text();
        } catch {
          return;
        }

        const trimmed = bodyText.trim();
        if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return;

        const parsed = tryParseJson(bodyText);
        if (!parsed || typeof parsed !== 'object') return;

        console.debug('[DEBUG] Playwright response received', {
          url,
          contentType,
          length: bodyText.length,
          snippet: bodyText.slice(0, 200),
        });

        const comments = parseAgentCommentsFromResponseBody(parsed, this.#seenCommentIdentifiers);
        if (comments.length > 0) {
          this.#callbacks.onComments(comments);
          console.debug('[DEBUG] Playwright response comment payload', {
            url,
            count: comments.length,
          });
        }
      });

      let response: any;
      try {
        response = await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        console.debug('[DEBUG] Playwright page goto complete', { responseStatus: response?.status(), url: page.url(), waitUntil: 'domcontentloaded' });
      } catch (err) {
        console.warn('[WARN] Playwright page domcontentloaded timeout, falling back to navigation commit', err);
        response = await page.goto(watchUrl, { waitUntil: 'commit', timeout: 30_000 });
        console.debug('[DEBUG] Playwright page goto complete', { responseStatus: response?.status(), url: page.url(), waitUntil: 'commit' });
      }
      console.debug('[DEBUG] Playwright page after goto', { url: page.url(), isClosed: page.isClosed(), pages: context.pages().map((p: any) => p.url()) });

      if (!page.isClosed()) {
        await this.tryOpenRenderedCommentPanel(page);
        try {
          const immediateComments = await this.extractPageComments(page);
          if (immediateComments.length > 0) {
            this.#callbacks.onComments(immediateComments);
            console.debug('[DEBUG] Playwright immediate page comments extracted', { count: immediateComments.length, url: page.url() });
          }
        } catch (err) {
          console.debug('[DEBUG] Playwright immediate page comment extraction failed', err);
        }
      }

      if (!page.isClosed()) {
        try {
          await page.waitForLoadState?.('networkidle', { timeout: 15_000 });
        } catch {
          console.debug('[DEBUG] Playwright networkidle wait failed or timed out', { url: page.url() });
        }
      }

      if (!page.isClosed()) {
        await this.waitForAnyCommentSelector(page, 15_000).catch(() => undefined);
      }

      const initialPageComments = await this.pollPageComments(page, 1_000);
      if (initialPageComments.length > 0) {
        this.#callbacks.onComments(initialPageComments);
        console.debug('[DEBUG] Playwright initial page comments extracted', { count: initialPageComments.length, url: page.url() });
      }

      if (page.isClosed()) {
        const survivingPage = context.pages().find((p: any) => !p.isClosed());
        if (survivingPage) {
          console.warn('[WARN] Playwright page closed after initial load; switching to surviving page', { url: watchUrl, survivingUrl: survivingPage.url() });
          page = survivingPage;
        } else {
          console.warn('[WARN] Playwright page closed before watcher installation could complete', { url: watchUrl });
          await context.close();
          return;
        }
      }

      this.#playwrightCommentContext = context;
      this.#playwrightCommentPage = page;
      this.startPlaywrightPagePolling(page);
    } catch (err) {
      console.warn('[WARN] failed to start Playwright comment watcher', err);
      await this.clearPlaywrightCommentWatcher();
    }
  }

  private async clearPlaywrightCommentWatcher(): Promise<void> {
    this.clearPlaywrightPagePolling();
    if (!this.#playwrightCommentContext) return;

    try {
      await this.#playwrightCommentContext.close();
    } catch (err) {
      console.warn('[WARN] failed to close Playwright comment watcher', err);
    }

    this.#playwrightCommentPage = null;
    this.#playwrightCommentContext = null;
  }

  private async tryOpenRenderedCommentPanel(page: any): Promise<void> {
    try {
      const commentButton = await page.$('[data-name="comment"], .comment-tab, .comment-panel button');
      if (!commentButton) return;
      await commentButton.click({ timeout: 2_000, force: true }).catch(() => undefined);
    } catch (err) {
      console.debug('[DEBUG] tryOpenRenderedCommentPanel failed', err);
    }
  }

  private async scanRenderedFrameForComments(frame: any): Promise<string[]> {
    try {
      const pageComments = await frame.evaluate(() => {
        const selectors = [
          '[data-name="comment"]',
          '.comment-panel',
          '.comment-list',
          '.comment-area',
          '.lv-comment',
          '.comment-item',
          '.base-comment-list',
          '[aria-label*=\"コメント\"]',
          '[role="log"]',
          '[class*=comment]',
          '[id*=comment]',
        ];

        const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();
        const exclude = (line: string) => ['コメント', 'コメント数', 'コメント一覧'].includes(line);
        const results = new Set<string>();

        const chooseCommentLine = (lines: string[]): string | null => {
          const candidates = lines.filter((line) => line.length > 0 && !exclude(line));
          if (candidates.length === 0) return null;
          return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
        };

        for (const selector of selectors) {
          const elements = Array.from(document.querySelectorAll(selector));
          for (const element of elements) {
            const content = element.textContent ?? '';
            const lines = content.split(/\r?\n/).map(normalize).filter((line) => line.length > 0 && !exclude(line));
            const comment = chooseCommentLine(lines);
            if (comment) {
              results.add(comment);
            }
          }
        }

        return Array.from(results).slice(0, 50);
      });

      if (!Array.isArray(pageComments) || pageComments.length === 0) {
        return [];
      }

      return pageComments.filter((comment) => typeof comment === 'string' && comment.trim().length > 0).map((comment) => comment.trim());
    } catch {
      return [];
    }
  }

  private async extractRenderedPageComments(page: any): Promise<AgentComment[]> {
    try {
      const commentLines = new Set<string>();
      const mainComments = await this.scanRenderedFrameForComments(page);
      for (const comment of mainComments) {
        commentLines.add(comment);
      }

      const frames = typeof page.frames === 'function' ? page.frames() : [];
      for (const frame of frames) {
        if (!frame || frame.url?.() === page.url?.()) continue;
        const frameComments = await this.scanRenderedFrameForComments(frame).catch(() => []);
        for (const comment of frameComments) {
          commentLines.add(comment);
        }
      }

      if (commentLines.size === 0) {
        return [];
      }

      return this.getUniquePageComments(Array.from(commentLines));
    } catch (err) {
      console.debug('[DEBUG] extractRenderedPageComments failed', err);
      return [];
    }
  }

  private async extractPageComments(page: any): Promise<AgentComment[]> {
    try {
      const renderedComments = await this.extractRenderedPageComments(page);
      if (renderedComments.length > 0) {
        return renderedComments;
      }

      const candidates = await page.evaluate(() => {
        const results: unknown[] = [];

        const safeParse = (text: string) => {
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        };

        const pushIfObject = (value: unknown) => {
          if (value && typeof value === 'object') {
            try {
              const serialized = JSON.parse(JSON.stringify(value));
              results.push(serialized);
            } catch {
              // ignore non-serializable values
            }
          }
        };

        const scanText = (text: string) => {
          const trimmed = text.trim();
          if (trimmed[0] === '{' || trimmed[0] === '[') {
            const parsed = safeParse(trimmed);
            if (parsed) {
              pushIfObject(parsed);
            }
          }
        };

        const scriptTags = Array.from(document.querySelectorAll('script'));
        for (const script of scriptTags) {
          const text = script.textContent ?? '';
          if (!text.includes('comment') && !text.includes('comments') && !text.includes('relive') && !text.includes('data-props')) {
            continue;
          }
          scanText(text);
        }

        const propElements = Array.from(document.querySelectorAll('[data-props]'));
        for (const element of propElements) {
          const value = element.getAttribute('data-props');
          if (value) {
            scanText(value);
          }
        }

        return results;
      });

      if (!Array.isArray(candidates)) return [];

      const comments = parseAgentCommentsFromResponseBody(candidates, this.#seenCommentIdentifiers);
      return comments;
    } catch (err) {
      console.debug('[DEBUG] extractPageComments failed', err);
      return [];
    }
  }

  private async pollPageComments(page: any, intervalMs = 1_000, maxAttempts = 5): Promise<AgentComment[]> {
    let attempts = 0;
    while (!page.isClosed() && attempts < maxAttempts) {
      attempts += 1;
      try {
        const pageComments = await this.extractPageComments(page);
        if (pageComments.length > 0) {
          return pageComments;
        }
      } catch (err) {
        console.debug('[DEBUG] pollPageComments failed', err);
        if (page.isClosed()) {
          break;
        }
      }

      try {
        await page.waitForTimeout(intervalMs);
      } catch {
        break;
      }
    }
    return [];
  }

  private startPlaywrightPagePolling(page: any): void {
    if (this.#playwrightPageCommentPollTimer) return;

    this.#playwrightPageCommentPollTimer = setInterval(async () => {
      if (!page || page.isClosed?.()) {
        this.clearPlaywrightPagePolling();
        return;
      }

      try {
        const comments = await this.extractPageComments(page);
        if (comments.length > 0) {
          this.#callbacks.onComments(comments);
          console.debug('[DEBUG] Playwright page polling comments', { count: comments.length, url: page.url() });
        }
      } catch (err) {
        console.debug('[DEBUG] Playwright page polling failed', err);
      }
    }, 5_000);
  }

  private clearPlaywrightPagePolling(): void {
    if (!this.#playwrightPageCommentPollTimer) return;
    clearInterval(this.#playwrightPageCommentPollTimer);
    this.#playwrightPageCommentPollTimer = null;
  }

  private getUniquePageComments(comments: string[]): AgentComment[] {
    const results: AgentComment[] = [];

    for (const comment of comments) {
      if (comment.length === 0) continue;
      const identifier = `none|unknown|${comment}`;
      if (this.#seenCommentIdentifiers.has(identifier)) continue;
      this.#seenCommentIdentifiers.add(identifier);
      results.push({ data: { comment } });
    }

    return results;
  }

  private async waitForAnyCommentSelector(page: any, timeoutMs: number): Promise<void> {
    const selectors = [
      '[data-name="comment"]',
      '.comment-panel',
      '[class*=comment]',
      '[id*=comment]',
      '[data-comment]',
      '[data-testid*="comment"]',
      '[aria-label*="コメント"]',
      '[role="log"]',
      '[class*=Comment]',
      '[id*=Comment]',
    ];

    if (typeof page.waitForSelector !== 'function') {
      return;
    }

    const waiters = selectors.map((selector) =>
      Promise.resolve(page.waitForSelector(selector, { timeout: timeoutMs })).catch(() => null),
    );
    await Promise.race(waiters);
  }

  private handlePlaywrightWebSocketFrame(payload: string, wsUrl: string): void {
    let body: unknown = null;
    try {
      body = JSON.parse(payload);
    } catch (err) {
      return;
    }

    if (!body || typeof body !== 'object') return;

    const comments = parseAgentCommentsFromResponseBody(body, this.#seenCommentIdentifiers);
    if (comments.length === 0) return;

    this.#callbacks.onComments(comments);
    console.debug('[DEBUG] Playwright websocket comment payload', { wsUrl, count: comments.length });
  }

  private async performImmediateRescan(watchUrl: string): Promise<void> {
    try {
      const data = await this.fetchEmbeddedDataFromPage(watchUrl).catch(() => null);
      if (!data) return;
      const comments = parseAgentCommentsFromResponseBody(data, this.#seenCommentIdentifiers);
      if (comments.length > 0) {
        this.#callbacks.onComments(comments);
        console.debug('[DEBUG] performImmediateRescan comments extracted', { count: comments.length, watchUrl });
      }
    } catch (err) {
      this.reportError(err);
    }
  }

  private handleDirectWebSocketMessage(message: string, wsUrl: string): void {
    if (!message) {
      console.debug('[DEBUG] direct websocket empty message received', wsUrl);
      return;
    }

    let body: unknown = null;
    try {
      body = JSON.parse(message);
    } catch (err) {
      console.warn('[WARN] direct websocket received non-JSON frame', wsUrl, message.slice(0, 200), err);
      return;
    }

    if (!body || typeof body !== 'object') {
      console.warn('[WARN] direct websocket received invalid frame body', wsUrl, message.slice(0, 200));
      return;
    }

    const eventType = (body as any).type;
    if (eventType === 'ping') {
      this.sendDirectWebSocketMessage({ type: 'keepSeat' });
      return;
    }

    let knownEventType = false;
    switch (eventType) {
      case 'statistics': {
        const metaState = buildNiconamaStreamStateFromStatisticsEvent(body);
        if (metaState) {
          this.#callbacks.onMeta(metaState);
        }
        knownEventType = true;
        break;
      }
      case 'reconnect':
      case 'reconnect_request':
      case 'actionComment':
      case 'action_comment':
      case 'postCommentResult':
      case 'post_comment_result':
      case 'error_message':
      case 'tag_updated':
        knownEventType = true;
        break;
      default:
        console.warn('[WARN] direct websocket unknown event type', eventType, wsUrl, JSON.stringify(body, null, 2));
        break;
    }

    const comments = parseAgentCommentsFromResponseBody(body, this.#seenCommentIdentifiers, eventType);
    if (comments.length > 0) {
      this.#callbacks.onComments(comments);
      if (knownEventType) {
        console.debug('[DEBUG] direct websocket known event type with comment payload', eventType, wsUrl, body);
      }
      return;
    }

    if (knownEventType) {
      console.debug('[DEBUG] direct websocket ignored known event type', eventType, wsUrl, body);
      return;
    }

    if (typeof eventType === 'string') {
      console.warn('[WARN] direct websocket unknown event type', eventType, wsUrl, body);
      return;
    }

    console.warn('[WARN] direct websocket unknown event without type', wsUrl, body);
  }

  private sendDirectWebSocketMessage(message: unknown): void {
    if (!this.#directWebSocket) return;
    try {
      console.debug('[DEBUG] direct websocket sending message', message);
      this.#directWebSocket.send(JSON.stringify(message));
    } catch (err) {
      console.warn('[WARN] failed to send direct websocket message', err);
    }
  }

  private tryParseJson(text: string): unknown {
    return tryParseJson(text);
  }

  async pollLoop(): Promise<void> {
    while (!this.#stopRequested && this.#running) {
      // Use a cancellable sleep so `stop()` can abort the wait promptly.
      await new Promise<void>((resolve) => {
        this.#pollCancelResolve = resolve;
        this.#pollTimer = globalThis.setTimeout(() => {
          this.#pollTimer = null;
          this.#pollCancelResolve = null;
          resolve();
        }, this.#pollIntervalMs) as any;
      });
      if (this.#stopRequested) break;
      if (!this.#directWebSocket) {
        const watchUrl = await this.resolveWatchUrl();
        if (watchUrl) {
          await this.setupDirectWebSocketConnection(watchUrl);
        }
      }
    }
  }

  private reportError(error: unknown): void {
    if (typeof this.#callbacks.onError === 'function') {
      this.#callbacks.onError(error);
    } else {
      console.warn('[WARN] NiconamaCommentClient error:', error instanceof Error ? error.message : String(error));
    }
  }
}

export const createNiconamaCommentClient = (
  options: NiconamaCommentClientOptions,
  callbacks: NiconamaCommentClientCallbacks,
): NiconamaCommentClient => new NiconamaCommentClient(options, callbacks);

const isCommentLikeObject = (object: unknown): boolean => {
  if (!object || typeof object !== 'object') return false;

  const text = (object as any).comment ?? (object as any).text ?? (object as any).body ?? (object as any).message ?? (object as any).content;
  if (typeof text !== 'string' || text.trim().length === 0) return false;

  return (
    typeof (object as any).no === 'number' ||
    typeof (object as any).num === 'number' ||
    typeof (object as any).userId === 'string' ||
    typeof (object as any).user_id === 'string' ||
    (object as any).anonymity !== undefined ||
    (object as any).isAnonymous !== undefined ||
    (object as any).hasGift !== undefined ||
    (object as any).gift !== undefined
  );
};

const collectNestedCommentArrays = (
  body: unknown,
  depth = 0,
  parentKey?: string,
  maxDepth = 4,
): unknown[] => {
  if (depth > maxDepth || !body || typeof body !== 'object') return [];

  const results: unknown[] = [];
  if (Array.isArray(body)) {
    if (
      (parentKey === 'comments' || parentKey === 'chat' || parentKey === 'chats') ||
      body.some(isCommentLikeObject)
    ) {
      results.push(body);
    }

    for (const item of body) {
      results.push(...collectNestedCommentArrays(item, depth + 1, undefined, maxDepth));
    }

    return results;
  }

  for (const [key, value] of Object.entries(body)) {
    results.push(...collectNestedCommentArrays(value, depth + 1, key, maxDepth));
  }

  return results;
};

export const hasCommentArrayStructure = (body: unknown): boolean => {
  if (!body || typeof body !== 'object') return false;
  const candidateArrays = [
    (body as any).comments,
    (body as any).chat,
    (body as any).chats,
    (body as any).data?.comments,
    (body as any).data?.chat,
    (body as any).data?.chats,
    (body as any).site?.state?.relive?.comments,
    (body as any).site?.state?.relive?.chat,
    (body as any).site?.state?.relive?.chats,
    (body as any).site?.relive?.comments,
    (body as any).site?.relive?.chat,
    (body as any).site?.relive?.chats,
    (body as any).data,
  ];

  if (candidateArrays.some(Array.isArray)) {
    return true;
  }

  return collectNestedCommentArrays(body).length > 0;
};

const collectCommentLikeObjects = (body: unknown, depth = 0, maxDepth = 4): unknown[] => {
  if (depth > maxDepth || !body || typeof body !== 'object') return [];

  const results: unknown[] = [];
  if (Array.isArray(body)) {
    for (const item of body) {
      results.push(...collectCommentLikeObjects(item, depth + 1, maxDepth));
    }
    return results;
  }

  if (isCommentLikeObject(body)) {
    results.push(body);
  }

  for (const value of Object.values(body)) {
    results.push(...collectCommentLikeObjects(value, depth + 1, maxDepth));
  }

  return results;
};

export const parseAgentCommentsFromResponseBody = (
  body: unknown,
  seenCommentIdentifiers: Set<string> = new Set<string>(),
  eventType?: string,
): AgentComment[] => {
  if (!body || typeof body !== 'object') return [];

  const rawComments: unknown[] = [];
  const candidateArrays = [
    (body as any).comments,
    (body as any).chat,
    (body as any).chats,
    (body as any).data?.comments,
    (body as any).data?.chat,
    (body as any).data?.chats,
    (body as any).site?.state?.relive?.comments,
    (body as any).site?.state?.relive?.chat,
    (body as any).site?.state?.relive?.chats,
    (body as any).site?.relive?.comments,
    (body as any).site?.relive?.chat,
    (body as any).site?.relive?.chats,
  ];

  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate)) {
      rawComments.push(...candidate);
    }
  }

  if (rawComments.length === 0 && Array.isArray((body as any).data)) {
    rawComments.push(...(body as any).data);
  }

  const commentEventTypes = new Set(['actionComment', 'action_comment']);
  if (rawComments.length === 0 && eventType && commentEventTypes.has(eventType)) {
    const maybeComment = (body as any).data;
    if (maybeComment && isCommentLikeObject(maybeComment)) {
      rawComments.push(maybeComment);
    }
  }

  if (rawComments.length === 0) {
    for (const nestedArray of collectNestedCommentArrays(body)) {
      rawComments.push(...nestedArray as unknown[]);
    }
  }

  const comments: AgentComment[] = [];
  const seenIdentifiers = seenCommentIdentifiers;

  for (const raw of rawComments) {
    if (!raw || typeof raw !== 'object') continue;
    const commentText = (raw as any).comment ?? (raw as any).text ?? (raw as any).body ?? (raw as any).message ?? (raw as any).content;
    if (typeof commentText !== 'string' || commentText.trim().length === 0) continue;
    const commentData: Record<string, unknown> = {
      comment: commentText,
      no: typeof (raw as any).no === 'number' ? (raw as any).no : typeof (raw as any).num === 'number' ? (raw as any).num : undefined,
      anonymity: Boolean((raw as any).anonymity ?? (raw as any).isAnonymous ?? false),
      hasGift: Boolean((raw as any).hasGift ?? (raw as any).gift ?? false),
      userId: (raw as any).userId ?? (raw as any).user_id ?? undefined,
      origin: raw,
    };
    const identifier = `${commentData.no ?? 'none'}|${commentData.userId ?? 'unknown'}|${commentData.comment}`;
    if (seenIdentifiers.has(identifier)) continue;
    seenIdentifiers.add(identifier);
    comments.push({ data: commentData });
  }

  return comments;
};
