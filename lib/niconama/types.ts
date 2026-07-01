/**
 * ニコ生コメントクライアント共通型定義
 */

export type DirectWebSocket = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  removeAllListeners?: () => void;
  onmessage: ((event: unknown) => void) | null;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  constructor: { OPEN?: number } & typeof Function;
};

type NiconamaBrowserPageResponse = {
  status: () => number;
  text: () => Promise<string>;
};

export type NiconamaBrowserPage = {
  on: (event: string, callback: (event: unknown) => void) => void;
  goto: (
    url: string,
    options?: Record<string, unknown>,
  ) => Promise<NiconamaBrowserPageResponse | null>;
  close: () => Promise<void>;
  evaluate: <T>(pageFunction: () => T) => Promise<T>;
  frames: () => Array<{
    evaluate: <T>(fn: () => T) => Promise<T>;
    url: () => string;
  }>;
  addInitScript: (script: () => void) => Promise<void>;
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
      click: (options?: { timeout?: number; force?: boolean }) => Promise<void>;
    };
    count: () => Promise<number>;
    allTextContents: () => Promise<string[]>;
  };
  $: (selector: string) => Promise<{
    click: (options?: Record<string, unknown>) => Promise<void>;
  } | null>;
  content: () => Promise<string>;
  waitFor: (options: Record<string, unknown>) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForLoadState?: (
    state?: string,
    options?: Record<string, unknown>,
  ) => Promise<void>;
  waitForSelector?: (
    selector: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  setDefaultTimeout?: (ms: number) => void;
  screenshot?: (options?: { path?: string }) => Promise<unknown>;
  url: () => string;
  isClosed: () => boolean;
};

export type NiconamaBrowserContext = {
  pages: () => NiconamaBrowserPage[];
  newPage: () => Promise<NiconamaBrowserPage>;
  close: () => Promise<void>;
  on?: (event: string, callback: (event: unknown) => void) => void;
};

export type NiconamaLaunchPersistentContext = (
  userDataDir: string,
  options?: Record<string, unknown>,
) => Promise<NiconamaBrowserContext>;

/** コメントクライアントの設定オプション */
export type NiconamaCommentClientOptions = {
  userDataDir?: string;
  executablePath?: string;
  watchUrl?: string;
  pollIntervalMs?: number;
  launchPersistentContext?: NiconamaLaunchPersistentContext;
  /**
   * falseにするとPlaywrightベースのフォールバックを無効化してWebSocketとREST APIポーリングのみで動作する。
   * デフォルト: `true`
   */
  enablePlaywrightFallback?: boolean;
};

/** コメントクライアントのコールバック */
export type NiconamaCommentClientCallbacks = {
  onComments: (comments: unknown[]) => void;
  onMeta: (state: unknown) => void;
  onError?: (error: unknown) => void;
};

export const DEFAULT_POLL_INTERVAL_MS = 30_000;
export const DEFAULT_WATCH_PAGE_BASE_URL = "https://live.nicovideo.jp";
export const DEFAULT_FALLBACK_WATCH_URL =
  "https://live.nicovideo.jp/watch/user/14171889";
export const NICONAMA_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
