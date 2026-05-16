import { existsSync, mkdirSync, statSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import type { BrowserContext, Page, ViewportSize } from "playwright";
import { chromium } from "./Browser/chromium";
import type { AgentComment } from "automated-gameplay-transmitter";

const DEFAULT_USER_DATA_DIR = './playwright/.auth/';
const DEFAULT_CHROMIUM_EXECUTABLE_PATH = '/usr/bin/chromium';

export const ensureUserDataDirExists = (userDataDir: string): void => {
  if (existsSync(userDataDir)) {
    if (!statSync(userDataDir).isDirectory()) {
      throw new Error(`userDataDir must be a directory: ${userDataDir}`);
    }
    return;
  }

  mkdirSync(userDataDir, { recursive: true });
};
const DEFAULT_VIEWPORT: ViewportSize = {
  width: 1280,
  height: 720,
};
const DEFAULT_NICONAMA_USER_ID = process.env.NICONAMA_USER_ID?.trim();
const DEFAULT_CANDIDATE_URLS = [
  'https://live.nicovideo.jp/',
  'https://live.nicovideo.jp/my',
  ...(DEFAULT_NICONAMA_USER_ID ? [`https://live.nicovideo.jp/watch/user/${DEFAULT_NICONAMA_USER_ID}`] : []),
];

export type NiconamaCommentClientOptions = {
  userDataDir?: string;
  executablePath?: string;
  pollIntervalMs?: number;
};

type NiconamaCommentClientCallbacks = {
  onComments: (comments: AgentComment[]) => void;
  onMeta: (state: unknown) => void;
  onError?: (error: unknown) => void;
};

export class NiconamaCommentClient {
  #userDataDir: string;
  #executablePath?: string;
  #pollIntervalMs: number;
  #context: BrowserContext | null = null;
  #page: Page | null = null;
  #running = false;
  #stopRequested = false;
  #pollTask: Promise<void> | null = null;
  #seenCommentSignatures = new Set<string>();
  #callbacks: NiconamaCommentClientCallbacks;

  constructor(options: NiconamaCommentClientOptions, callbacks: NiconamaCommentClientCallbacks) {
    this.#userDataDir = options.userDataDir ?? DEFAULT_USER_DATA_DIR;
    this.#executablePath = options.executablePath;
    this.#pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.#callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#stopRequested = false;

    ensureUserDataDirExists(this.#userDataDir);

    const executablePath = this.#executablePath ?? DEFAULT_CHROMIUM_EXECUTABLE_PATH;
    const launchOptions = {
      executablePath,
      headless: true,
      timeout: 60_000,
      args: [
        '--hide-scrollbars',
        '--window-size=1024,576',
        '--window-position=1280,600',
      ],
      viewport: DEFAULT_VIEWPORT,
    } as const;

    const context = await (chromium as any).launchPersistentContext(this.#userDataDir, launchOptions) as BrowserContext;
    context.setDefaultTimeout(0);

    const pages = context.pages();
    const page = pages[0] ?? await context.newPage();
    page.setDefaultTimeout(0);

    this.#context = context;
    this.#page = page;
    this.#running = true;

    this.setupResponseWatcher(page);
    await this.refreshLivePageState();

    this.#pollTask = this.pollLoop();
  }

  async stop(): Promise<void> {
    this.#stopRequested = true;
    if (this.#pollTask) {
      await this.#pollTask;
      this.#pollTask = null;
    }
    if (this.#context) {
      try { await this.#context.close(); } catch { }
      this.#context = null;
      this.#page = null;
    }
    this.#running = false;
  }

  isRunning(): boolean {
    return this.#running;
  }

  async refreshLivePageState(): Promise<void> {
    if (!this.#page) return;

    const liveUrl = await this.findLiveUrl();
    if (liveUrl) {
      try {
        await this.#page.goto(liveUrl, { waitUntil: 'domcontentloaded' });
      } catch (err) {
        this.reportError(err);
      }
    }

    try {
      const meta = await this.extractMetaFromPage(this.#page);
      this.#callbacks.onMeta({
        type: 'niconama',
        data: {
          isLive: meta.isLive,
          title: meta.title,
          startTime: meta.startTime,
          total: meta.listeners,
          points: { gift: meta.gift ?? 0, ad: meta.ad ?? 0 },
          url: meta.url,
        },
      });
    } catch (err) {
      this.reportError(err);
    }
  }

  async pollLoop(): Promise<void> {
    while (!this.#stopRequested && this.#running) {
      await setTimeout(this.#pollIntervalMs);
      if (this.#stopRequested) break;
      try {
        await this.refreshLivePageState();
      } catch (err) {
        this.reportError(err);
      }
    }
  }

  private async findLiveUrl(): Promise<string | null> {
    if (!this.#page) return null;

    try {
      const currentUrl = this.#page.url();
      if (/\/watch\/lv\d+/.test(currentUrl)) {
        return currentUrl;
      }

      await this.#page.goto('https://live.nicovideo.jp/', { waitUntil: 'domcontentloaded' });


      // Hover した結果表示される要素を探すため、hover 前の可視状態を記録します。
      const livePageAnchors = this.#page.getByText('放送中のページ', { exact: true });
      const anchorCountBefore = await livePageAnchors.count();
      const visibleBefore: boolean[] = [];
      for (let index = 0; index < anchorCountBefore; index += 1) {
        visibleBefore[index] = await livePageAnchors.nth(index).isVisible().catch(() => false);
      }

      const makoAnchorLocator = this.#page.getByText('馬可無序', { exact: true }).first();
      await makoAnchorLocator.hover();

      const deadline = Date.now() + 5_000;
      let hoverResultLocator: typeof livePageAnchors | null = null;
      while (Date.now() < deadline) {
        const anchorCountAfter = await livePageAnchors.count();
        for (let index = 0; index < anchorCountAfter; index += 1) {
          const candidate = livePageAnchors.nth(index);
          const isVisible = await candidate.isVisible().catch(() => false);
          const wasVisibleBefore = index < anchorCountBefore ? visibleBefore[index] : false;
          if (isVisible && !wasVisibleBefore) {
            hoverResultLocator = candidate;
            break;
          }
        }
        if (hoverResultLocator) break;
        await this.#page.waitForTimeout(100);
      }

      if (!hoverResultLocator) {
        return null;
      }

      const livePageUrl = await hoverResultLocator.getAttribute('href');
      if (!livePageUrl) {
        return null;
      }

      const absoluteLivePageUrl = new URL(livePageUrl, this.#page.url()).href;
      await this.#page.goto(absoluteLivePageUrl, { waitUntil: 'domcontentloaded' });

      const finalUrl = this.#page.url();
      if (!/\/watch\/lv\d+/.test(finalUrl)) {
        throw new Error(`Hovered live page did not resolve to a watch URL: ${finalUrl}`);
      }

      return finalUrl;
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  private async findLiveUrlFromCurrentPage(): Promise<string | null> {
    if (!this.#page) return null;
    return await this.#page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
      const firstLive = anchors.find((a) => {
        try {
          return /\/watch\/lv\d+/.test(new URL(a.href, location.href).href);
        } catch {
          return false;
        }
      });
      return firstLive ? new URL(firstLive.href, location.href).href : null;
    });
  }

  private setupResponseWatcher(page: Page): void {
    page.on('response', async (response) => {
      try {
        const contentType = response.headers()['content-type'] ?? '';
        if (!contentType.includes('application/json')) return;
        const url = response.url();
        if (!/comment|chat|live|niconama/i.test(url)) return;

        const body = await response.json().catch(() => null);
        if (!body) return;

        const comments = parseAgentCommentsFromResponseBody(body, this.#seenCommentSignatures);
        if (comments.length > 0) {
          console.debug('[DEBUG] NiconamaCommentClient captured comments from response:', url, 'count=', comments.length);
          this.#callbacks.onComments(comments);
        } else if (!hasCommentArrayStructure(body)) {
          console.warn('[WARN] NiconamaCommentClient received a comment-related response without any comment arrays:', url);
        }
      } catch (err) {
        this.reportError(err);
      }
    });
  }

  private async extractMetaFromPage(page: Page): Promise<{ title: string; url: string; isLive: boolean; startTime: number; listeners?: number; gift?: number; ad?: number }> {
    return await page.evaluate(() => {
      const title = document.title || (document.querySelector('h1')?.textContent?.trim() ?? 'NicoNico Live');
      const url = location.href;
      const text = document.body.textContent ?? '';
      const isLive = /\/watch\/lv\d+/.test(url) && !/(終了|放送を終了|終了しました)/.test(text);
      const startTime = Date.now();

      const listenersText = document.querySelector('[class*="viewer"], [class*="視聴者数"], [class*="watch-count"]')?.textContent ?? '';
      const listeners = Number.parseInt(listenersText.replace(/[^0-9]/g, ''), 10);
      const gift = 0;
      const ad = 0;
      return {
        title: title.trim(),
        url,
        isLive,
        startTime,
        listeners: Number.isFinite(listeners) ? listeners : undefined,
        gift,
        ad,
      };
    });
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

export const hasCommentArrayStructure = (body: unknown): boolean => {
  if (!body || typeof body !== 'object') return false;
  const candidateArrays = [
    (body as any).comments,
    (body as any).chat,
    (body as any).chats,
    (body as any).data?.comments,
    (body as any).data?.chat,
    (body as any).data?.chats,
    (body as any).data,
  ];

  return candidateArrays.some(Array.isArray);
};

export const parseAgentCommentsFromResponseBody = (
  body: unknown,
  seenCommentSignatures: Set<string> = new Set<string>(),
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
  ];

  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate)) {
      rawComments.push(...candidate);
    }
  }

  if (rawComments.length === 0 && Array.isArray((body as any).data)) {
    rawComments.push(...(body as any).data);
  }

  const comments: AgentComment[] = [];
  const seenSignatures = seenCommentSignatures;

  for (const raw of rawComments) {
    if (!raw || typeof raw !== 'object') continue;
    const commentText = (raw as any).comment ?? (raw as any).text ?? (raw as any).body ?? (raw as any).message;
    if (typeof commentText !== 'string' || commentText.trim().length === 0) continue;
    const commentData: Record<string, unknown> = {
      comment: commentText,
      no: typeof (raw as any).no === 'number' ? (raw as any).no : typeof (raw as any).num === 'number' ? (raw as any).num : undefined,
      anonymity: Boolean((raw as any).anonymity ?? (raw as any).isAnonymous ?? false),
      hasGift: Boolean((raw as any).hasGift ?? (raw as any).gift ?? false),
      userId: (raw as any).userId ?? (raw as any).user_id ?? undefined,
      origin: raw,
    };
    const signature = `${commentData.no ?? 'none'}|${commentData.userId ?? 'unknown'}|${commentData.comment}`;
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);
    comments.push({ data: commentData });
  }

  return comments;
};
