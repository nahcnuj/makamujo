import { existsSync, mkdirSync, statSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import type { BrowserContext, Page, ViewportSize } from "playwright";
import { chromium } from "./Browser/chromium";
import type { AgentComment } from "automated-gameplay-transmitter";

const DEFAULT_USER_DATA_DIR = './playwright/.auth/';
const DEFAULT_CHROMIUM_EXECUTABLE_PATH = '/usr/bin/chromium';

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
const DEFAULT_VIEWPORT: ViewportSize = {
  width: 1280,
  height: 720,
};
/** `NiconamaCommentClient` の生成オプション。 */
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

/**
 * Playwright の Chromium ブラウザを使って NicoNico 生放送のコメントと放送情報を取得するクライアント。
 * ページの HTTP レスポンスを監視してコメントを抽出し、定期的に放送情報を更新する。
 */
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

  /** クライアントを初期化する。実際のブラウザ起動は {@link start} を呼ぶまで行わない。 */
  constructor(options: NiconamaCommentClientOptions, callbacks: NiconamaCommentClientCallbacks) {
    this.#userDataDir = options.userDataDir ?? DEFAULT_USER_DATA_DIR;
    this.#executablePath = options.executablePath;
    this.#pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.#callbacks = callbacks;
  }

  /**
   * Chromium を起動してライブページを開き、コメント監視と定期ポーリングを開始する。
   * すでに起動済みの場合は何もしない。
   */
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

  /**
   * ポーリングを停止し、ブラウザコンテキストを閉じる。
   * ポーリングループが実行中の場合は完了まで待機する。
   */
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

  /** ブラウザが起動中かどうかを返す。 */
  isRunning(): boolean {
    return this.#running;
  }

  /**
   * ライブページに遷移して放送情報を取得し、`onMeta` コールバックを呼び出す。
   * ライブ URL が見つからない場合は遷移をスキップして放送情報の抽出のみ行う。
   */
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
      // Try to extract any already-rendered comments from the DOM. Many
      // watch pages render a virtualized comment list (table rows with
      // `data-comment-type` and `.comment-text` spans). Class names are
      // often obfuscated, so the evaluator uses resilient selectors.
      try {
        const domComments = await this.extractCommentsFromDom(this.#page);
        if (domComments.length > 0) {
          this.#callbacks.onComments(domComments);
        }
      } catch (err) {
        this.reportError(err);
      }
    } catch (err) {
      this.reportError(err);
    }
  }

  /**
   * `pollIntervalMs` ごとに {@link refreshLivePageState} を呼び出し続けるループ。
   * {@link stop} が呼ばれると次のインターバル後に終了する。
   */
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

  /**
   * 現在のページが視聴ページであればそのURLを返す。
   * そうでなければ NicoNico トップページを開き、「馬可無序」のホバーメニューから
   * 「放送中のページ」リンクを探して遷移し、視聴ページの URL を返す。
   * ライブが見つからない場合は `null` を返す。
   */
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

  /**
   * ページの HTTP レスポンスを監視し、コメント系 JSON レスポンスからコメントを抽出する。
   * コメントが取得できた場合は `onComments` を呼び出す。
   * コメント配列構造が含まれないレスポンスを受け取った場合は WARN ログを出力する。
   */
  private setupResponseWatcher(page: Page): void {
    page.on('response', async (response) => {
      try {
        const contentType = response.headers()['content-type'] ?? '';
        if (!contentType.includes('application/json')) return;
        const url = response.url();

        // Avoid matching ad endpoints that include the page URL as a query
        // parameter. Use the response pathname to determine whether this is
        // likely a comment/chat endpoint.
        let pathname = '';
        try { pathname = new URL(url).pathname; } catch { pathname = ''; }
        if (!/(?:comment|comments|chat|chats)/i.test(pathname)) return;

        const body = await response.json().catch(() => null);
        if (!body) return;

        const comments = parseAgentCommentsFromResponseBody(body, this.#seenCommentSignatures);
        if (comments.length > 0) {
          console.debug('[DEBUG] NiconamaCommentClient captured comments from response:', url, 'count=', comments.length);
          this.#callbacks.onComments(comments);
        } else if (!hasCommentArrayStructure(body)) {
          // コメント系レスポンスなのにコメント配列が見つからなかった観察結果を記録する。
          // 例外ではないため reportError() は使わず console.warn を直接呼ぶ。
          console.warn('[WARN] NiconamaCommentClient received a comment-related response without any comment arrays:', url);
        }
      } catch (err) {
        this.reportError(err);
      }
    });

    // Monitor WebSocket frames for comment-like JSON payloads (real-time comments).
    page.on('websocket', (ws) => {
      try {
        const wsUrl = (ws as any).url?.() ?? '';
        (ws as any).on?.('framereceived', (message: string) => {
          try {
            if (!message || typeof message !== 'string') return;
            let body: unknown = null;
            try { body = JSON.parse(message); } catch { body = null; }
            if (!body) return;

            const comments = parseAgentCommentsFromResponseBody(body, this.#seenCommentSignatures);
            if (comments.length > 0) {
              console.debug('[DEBUG] NiconamaCommentClient captured comments from websocket:', wsUrl, 'count=', comments.length);
              this.#callbacks.onComments(comments);
            } else if (!hasCommentArrayStructure(body)) {
              console.warn('[WARN] NiconamaCommentClient received a comment-related websocket frame without any comment arrays:', wsUrl);
            }
          } catch (err) {
            this.reportError(err);
          }
        });
      } catch (err) {
        this.reportError(err);
      }
    });
  }

  /**
   * ページの DOM を走査してコメント一覧を抽出する。クラス名が変化しても
   * 動作するよう、`data-comment-type` や `.comment-text` にフォールバックして
   * テキストを収集する。重複は `#seenCommentSignatures` で除外する。
   */
  private async extractCommentsFromDom(page: Page): Promise<AgentComment[]> {
    if (!page) return [];
    try {
      const raw: Array<{ comment: string; no?: number; userId?: string }> = await page.evaluate(() => {
        const results: Array<{ comment: string; no?: number; userId?: string }> = [];
        const seen = new Set<string>();

        // Candidate row-like containers that commonly hold comments.
        const rowSelectors = [
          '[data-comment-type]',
          '[data-role="comment"]',
          '[data-name="comment"]',
          '[class*="comment-data-grid"] [role="row"]',
          '[class*="table-row"]',
          '[role="row"]',
        ];

        for (const sel of rowSelectors) {
          for (const el of Array.from(document.querySelectorAll(sel))) {
            try {
              const elAny = el as HTMLElement;
              // Prefer an explicit `.comment-text` if present.
              let textEl = elAny.querySelector('.comment-text') as HTMLElement | null;
              if (!textEl) {
                // Fallbacks: content-area, inner-content, or the first meaningful span
                textEl = elAny.querySelector('.content-area .comment-text') as HTMLElement | null
                  || elAny.querySelector('[class*="comment-text"]') as HTMLElement | null
                  || elAny.querySelector('.content-area') as HTMLElement | null
                  || elAny.querySelector('span') as HTMLElement | null;
              }
              const comment = textEl?.textContent?.trim() ?? '';
              if (!comment) continue;

              // Attempt to extract a numeric comment number if available.
              let no: number | undefined;
              const noEl = elAny.querySelector('.comment-number') || elAny.querySelector('[data-no]') || elAny.querySelector('[data-index]');
              if (noEl && typeof noEl.textContent === 'string') {
                const m = noEl.textContent.match(/\d+/);
                if (m) no = Number.parseInt(m[0], 10);
              }

              const signature = `${no ?? 'none'}|${comment}`;
              if (seen.has(signature)) continue;
              seen.add(signature);
              results.push({ comment, no, userId: undefined });
            } catch {
              // ignore per-row errors
            }
          }
        }

        // As a final fallback, search for standalone comment-text spans.
        for (const el of Array.from(document.querySelectorAll('span[class*="comment-text"], .comment-text'))) {
          try {
            const text = (el as HTMLElement).textContent?.trim() ?? '';
            if (!text) continue;
            const row = (el as HTMLElement).closest('[data-comment-type], [role="row"]');
            let no: number | undefined;
            const noEl = row?.querySelector('.comment-number') || row?.querySelector('[data-no]');
            if (noEl && typeof (noEl as HTMLElement).textContent === 'string') {
              const m = (noEl as HTMLElement).textContent!.match(/\d+/);
              if (m) no = Number.parseInt(m[0], 10);
            }
            const signature = `${no ?? 'none'}|${text}`;
            if (seen.has(signature)) continue;
            seen.add(signature);
            results.push({ comment: text, no, userId: undefined });
          } catch {
            // ignore
          }
        }

        return results.slice(0, 500);
      });

      const comments: AgentComment[] = [];
      for (const item of raw) {
        const comment = typeof item.comment === 'string' ? item.comment.trim() : '';
        if (!comment) continue;
        const no = typeof item.no === 'number' ? item.no : undefined;
        const userId = item.userId ?? undefined;
        const signature = `${no ?? 'none'}|${userId ?? 'unknown'}|${comment}`;
        if (this.#seenCommentSignatures.has(signature)) continue;
        this.#seenCommentSignatures.add(signature);
        comments.push({ data: { comment, no, anonymity: false, hasGift: false, userId, origin: item } });
      }

      return comments;
    } catch (err) {
      this.reportError(err);
      return [];
    }
  }

  /**
   * ページの DOM から放送タイトル・URL・放送中フラグ・視聴者数などの放送情報を抽出して返す。
   */
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

  /**
   * 例外・障害を通知するメソッド。
   * `onError` コールバックが設定されていれば呼び出し元に伝播する。
   * 単なる観察結果の記録（コメント配列がなかった等）には使わず、
   * 捕捉した例外（`catch` ブロック内の `err`）に限って呼び出すこと。
   */
  private reportError(error: unknown): void {
    if (typeof this.#callbacks.onError === 'function') {
      this.#callbacks.onError(error);
    } else {
      console.warn('[WARN] NiconamaCommentClient error:', error instanceof Error ? error.message : String(error));
    }
  }
}

/** {@link NiconamaCommentClient} のファクトリ関数。 */
export const createNiconamaCommentClient = (
  options: NiconamaCommentClientOptions,
  callbacks: NiconamaCommentClientCallbacks,
): NiconamaCommentClient => new NiconamaCommentClient(options, callbacks);

/**
 * レスポンスボディにコメント配列構造（`comments` / `chat` / `chats` / `data.comments` 等）が
 * 含まれるかどうかを返す。配列が空であっても `true` を返す。
 */
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

/**
 * レスポンスボディからコメントを抽出して返す。
 * `seenCommentSignatures` に同一シグネチャのコメントが登録済みの場合は除外する（重複排除）。
 * 抽出したコメントのシグネチャは `seenCommentSignatures` に追記される。
 */
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
