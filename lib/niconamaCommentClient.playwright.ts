import type { AgentComment } from "automated-gameplay-transmitter";
import { parseAgentCommentsFromResponseBody } from "./niconamaCommentClient.helpers";

type PlaywrightFrame = {
  evaluate: <T>(fn: () => T) => Promise<T>;
  url: () => string;
};

type PlaywrightPage = {
  isClosed: () => boolean;
  evaluate: <T>(fn: () => T) => Promise<T>;
  frames: () => PlaywrightFrame[];
  addInitScript: (script: () => void) => Promise<void>;
  locator: (selector: string) => {
    count: () => Promise<number>;
    allTextContents: () => Promise<string[]>;
    first: () => {
      hover: (options?: { timeout?: number }) => Promise<void>;
      waitFor: (options?: Record<string, unknown>) => Promise<void>;
    };
  };
  url: () => string;
  waitForSelector: (
    selector: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  waitForTimeout?: (ms: number) => Promise<void>;
};

export const addNiconamaPlaywrightInitScript = async (
  page: NiconamaBrowserPage,
): Promise<void> => {
  try {
    await page.addInitScript(() => {
      try {
        // suppress page unload hooks and replace close/open to avoid remote scripts
        // ejecting our instrumented browser instance.
        Object.defineProperty(window, "close", {
          configurable: true,
          writable: true,
          value: () => undefined,
        });
      } catch {}
      try {
        Object.defineProperty(window, "open", {
          configurable: true,
          writable: true,
          value: () => null,
        });
      } catch {}
      try {
        window.onbeforeunload = null;
      } catch {}
      try {
        window.onunload = null;
      } catch {}
      const origAdd = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (
        type: string,
        listener: EventListener | EventListenerObject,
        opts: unknown,
      ) {
        if (type === "beforeunload" || type === "unload") return;
        return origAdd.call(this, type, listener, opts);
      };
    });
  } catch {
    // ignore script injection failures
  }
};

export const getBodyTextFromPage = async (
  page: NiconamaBrowserPage,
): Promise<string | null> => {
  if (page.isClosed()) return null;

  try {
    const locator = page.locator("body");
    const contents = await locator.allTextContents();
    if (Array.isArray(contents) && contents.length > 0) {
      return contents.join("");
    }
  } catch {
    // ignore locator failures
  }

  try {
    if (typeof page.evaluate === "function") {
      const bodyText = await page.evaluate(
        () => document.body?.textContent ?? null,
      );
      return typeof bodyText === "string" ? bodyText : null;
    }
  } catch {
    // ignore evaluate failures
  }

  return null;
};

export const extractBodyTextFromHtml = (html: string): string | null => {
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const source = bodyMatch?.[1] ?? html;
  const withoutScripts = source.replace(/<script[\s\S]*?<\/script>/gi, "");
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, "");
  const text = withoutStyles
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
};

export const scanRenderedFrameForComments = async (
  frame: PlaywrightFrame,
): Promise<string[]> => {
  try {
    const pageComments = await frame.evaluate(() => {
      const selectors = [
        '[data-name="comment"]',
        ".comment-panel",
        ".comment-list",
        ".comment-area",
        ".lv-comment",
        ".comment-item",
        ".base-comment-list",
        '[aria-label*="コメント"]',
        '[role="log"]',
        "[class*=comment]",
        "[id*=comment]",
      ];

      const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
      const exclude = (line: string) =>
        ["コメント", "コメント数", "コメント一覧"].includes(line);
      const results = new Set<string>();

      const chooseCommentLine = (lines: string[]) => {
        const candidates = lines.filter(
          (line) => line.length > 0 && !exclude(line),
        );
        if (candidates.length === 0) return null;
        return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
      };

      for (const selector of selectors) {
        const elements = Array.from(document.querySelectorAll(selector));
        for (const element of elements) {
          const content = element.textContent ?? "";
          const lines = content
            .split(/\r?\n/)
            .map(normalize)
            .filter((line) => line.length > 0 && !exclude(line));
          const comment = chooseCommentLine(lines);
          if (comment) results.add(comment);
        }
      }
      return Array.from(results).slice(0, 50);
    });

    if (!Array.isArray(pageComments) || pageComments.length === 0) return [];
    return pageComments
      .filter(
        (comment) => typeof comment === "string" && comment.trim().length > 0,
      )
      .map((comment) => comment.trim());
  } catch {
    return [];
  }
};

export const getUniquePageComments = (
  comments: string[],
  seenCommentIdentifiers: Set<string>,
): AgentComment[] => {
  const results: AgentComment[] = [];
  for (const comment of comments) {
    if (comment.length === 0) continue;
    const identifier = `none|unknown|${comment}`;
    if (seenCommentIdentifiers.has(identifier)) continue;
    seenCommentIdentifiers.add(identifier);
    results.push({ data: { comment } });
  }
  return results;
};

export const extractRenderedPageComments = async (
  page: NiconamaBrowserPage,
  seenCommentIdentifiers: Set<string>,
): Promise<AgentComment[]> => {
  try {
    const commentLines = new Set<string>();
    const mainComments = await scanRenderedFrameForComments(page);
    for (const comment of mainComments) commentLines.add(comment);

    const frames = typeof page.frames === "function" ? page.frames() : [];
    for (const frame of frames) {
      if (!frame || frame.url?.() === page.url?.()) continue;
      const frameComments = await scanRenderedFrameForComments(frame).catch(
        () => [],
      );
      for (const comment of frameComments) commentLines.add(comment);
    }

    if (commentLines.size === 0) return [];
    return getUniquePageComments(
      Array.from(commentLines),
      seenCommentIdentifiers,
    );
  } catch {
    return [];
  }
};

export const extractPageComments = async (
  page: NiconamaBrowserPage,
  seenCommentIdentifiers: Set<string>,
): Promise<AgentComment[]> => {
  if (page.isClosed()) return [];
  const renderedComments = await extractRenderedPageComments(
    page,
    seenCommentIdentifiers,
  );
  if (renderedComments.length > 0) return renderedComments;

  try {
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
        if (value && typeof value === "object") {
          try {
            results.push(JSON.parse(JSON.stringify(value)));
          } catch {}
        }
      };
      const scanText = (text: string) => {
        const trimmed = text.trim();
        if (trimmed[0] === "{" || trimmed[0] === "[") {
          const parsed = safeParse(trimmed);
          if (parsed) pushIfObject(parsed);
        }
      };

      const scriptTags = Array.from(document.querySelectorAll("script"));
      for (const script of scriptTags) {
        const text = script.textContent ?? "";
        if (
          !text.includes("comment") &&
          !text.includes("comments") &&
          !text.includes("relive") &&
          !text.includes("data-props")
        )
          continue;
        scanText(text);
      }

      const propElements = Array.from(
        document.querySelectorAll("[data-props]"),
      );
      for (const element of propElements) {
        const value = element.getAttribute("data-props");
        if (value) scanText(value);
      }

      return results;
    });

    if (!Array.isArray(candidates)) return [];
    return parseAgentCommentsFromResponseBody(
      candidates,
      seenCommentIdentifiers,
    );
  } catch {
    return [];
  }
};

export const pollPageComments = async (
  page: NiconamaBrowserPage,
  seenCommentIdentifiers: Set<string>,
  intervalMs = 1_000,
  maxAttempts = 30,
): Promise<AgentComment[]> => {
  let attempts = 0;
  while (!page.isClosed() && attempts < maxAttempts) {
    attempts += 1;
    try {
      const pageComments = await extractPageComments(
        page,
        seenCommentIdentifiers,
      );
      if (pageComments.length > 0) return pageComments;
    } catch {
      if (page.isClosed?.()) break;
    }
    try {
      await page.waitForTimeout(intervalMs);
    } catch {
      break;
    }
  }
  return [];
};

export const startPlaywrightPagePolling = (
  page: NiconamaBrowserPage,
  seenCommentIdentifiers: Set<string>,
  onComments: (comments: AgentComment[]) => void,
): ReturnType<typeof setInterval> => {
  return setInterval(async () => {
    if (page.isClosed()) return;
    try {
      const comments = await extractPageComments(page, seenCommentIdentifiers);
      if (comments.length > 0) onComments(comments);
    } catch {
      // ignore polling failures
    }
  }, 1_000);
};

export const waitForAnyCommentSelector = async (
  page: NiconamaBrowserPage,
  timeoutMs: number,
): Promise<void> => {
  const selectors = [
    '[data-name="comment"]',
    ".comment-panel",
    "[class*=comment]",
    "[id*=comment]",
    "[data-comment]",
    '[data-testid*="comment"]',
    '[aria-label*="コメント"]',
    '[role="log"]',
    "[class*=Comment]",
    "[id*=Comment]",
  ];
  const waiters = selectors.map((selector) =>
    Promise.resolve(
      page.waitForSelector(selector, { timeout: timeoutMs }),
    ).catch(() => null),
  );
  await Promise.race(waiters);
};

export const tryOpenRenderedCommentPanel = async (
  page: NiconamaBrowserPage,
): Promise<void> => {
  if (page.isClosed()) return;
  const safeEval = async <T>(
    p: PlaywrightPage,
    fn: (pp: PlaywrightPage) => Promise<T> | T,
  ): Promise<T | null> => {
    try {
      return await fn(p);
    } catch {
      return null;
    }
  };

  if (typeof page.$ === "function") {
    const commentButton = await safeEval(page, (pp) =>
      pp.$('[data-name="comment"], .comment-tab, .comment-panel button'),
    );
    if (commentButton) {
      await safeEval(commentButton, (b: unknown) =>
        b.click({ timeout: 2_000, force: true }),
      );
      return;
    }
  }

  if (typeof page.locator === "function") {
    const loc = await safeEval(page, (pp) =>
      pp.locator('[data-name="comment"], .comment-tab, .comment-panel button'),
    );
    if (loc && typeof loc.first === "function") {
      await safeEval(loc.first(), (l: unknown) => l.click({ timeout: 2_000 }));
      return;
    }
  }

  if (typeof page.evaluate === "function") {
    await safeEval(page, (pp) =>
      pp.evaluate(() => {
        const sel =
          '[data-name="comment"], .comment-tab, .comment-panel button';
        const el = document.querySelector(sel);
        if (!el) return false;
        try {
          (el as HTMLElement).click();
        } catch {}
        return true;
      }),
    );
  }
};
