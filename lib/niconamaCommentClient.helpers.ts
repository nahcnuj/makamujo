import { existsSync, mkdirSync, statSync } from 'node:fs';
import type { AgentComment } from 'automated-gameplay-transmitter';

export const ensureUserDataDirExists = (userDataDir: string): void => {
  // keep minimal behavior: ensure directory exists or throw when path exists but not a dir
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
  if (listeners === undefined && comments === undefined && adPoints === undefined && giftPoints === undefined) return null;
  const streamState: Record<string, unknown> = {};
  const total: Record<string, number> = {};
  if (listeners !== undefined) total.listeners = listeners;
  if (adPoints !== undefined) total.ad = adPoints;
  if (giftPoints !== undefined) total.gift = giftPoints;
  if (Object.keys(total).length > 0) {
    streamState.niconama = { type: 'live', meta: { total } };
  }
  if (comments !== undefined) streamState.commentCount = comments;
  return Object.keys(streamState).length > 0 ? streamState : null;
};

export const extractEmbeddedDataFromHtml = (html: string): unknown | null => {
  const findEmbeddedDataOpenTag = (input: string): string | null => {
    let searchIndex = 0;
    while (true) {
      const openIndex = input.indexOf('<', searchIndex);
      if (openIndex === -1) return null;
      const tagNameMatch = /^[ \t\n\r]*([A-Za-z]+)/.exec(input.slice(openIndex + 1));
      if (!tagNameMatch) { searchIndex = openIndex + 1; continue; }
      const tagName = tagNameMatch[1]!.toLowerCase();
      if (tagName !== 'script' && tagName !== 'div') { searchIndex = openIndex + 1; continue; }
      let cursor = openIndex + 1 + tagNameMatch[0].length;
      let quoteChar: string | null = null;
      while (cursor < input.length) {
        const char = input[cursor];
        if (quoteChar) {
          if (char === quoteChar) quoteChar = null;
        } else if (char === '"' || char === "'") {
          quoteChar = char;
        } else if (char === '>') {
          break;
        }
        cursor += 1;
      }
      if (cursor >= input.length) return null;
      const openTag = input.slice(openIndex, cursor + 1);
      if (/\bid\s*=\s*(['"])embedded-data\1/i.test(openTag)) return openTag;
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
      if (quote !== '"' && quote !== "'") { searchIndex = cursor; continue; }
      const valueStart = cursor + 1;
      let valueEnd = valueStart;
      while (valueEnd < openTag.length) {
        const char = openTag[valueEnd];
        if (char === quote) return openTag.slice(valueStart, valueEnd);
        if (char === '\\' && valueEnd + 1 < openTag.length) { valueEnd += 2; continue; }
        valueEnd += 1;
      }
      return null;
    }
  };

  const parseJsonFromRaw = (raw: string): unknown | null => {
    const normalized = normalizeHtmlForUrlExtraction(raw);
    const parsed = tryParseJson(normalized);
    if (parsed) return parsed;
    try { JSON.parse(normalized); } catch (err) { /* ignore */ }
    return null;
  };

  const openTag = findEmbeddedDataOpenTag(html);
  if (openTag) {
    const rawDataProps = extractDataPropsValue(openTag);
    if (rawDataProps) {
      const parsed = parseJsonFromRaw(rawDataProps);
      if (parsed) return parsed;
    }
  }

  const attrMatch = html.match(/data-props=(['"])([\s\S]*?)\1/i);
  if (attrMatch && attrMatch[2]) {
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

const collectNestedCommentArrays = (body: unknown, depth = 0, parentKey?: string, maxDepth = 4): unknown[] => {
  if (depth > maxDepth || !body || typeof body !== 'object') return [];
  const results: unknown[] = [];
  if (Array.isArray(body)) {
    if ((parentKey === 'comments' || parentKey === 'chat' || parentKey === 'chats') || body.some(isCommentLikeObject)) {
      results.push(body);
    }
    for (const item of body) results.push(...collectNestedCommentArrays(item, depth + 1, undefined, maxDepth));
    return results;
  }
  for (const [key, value] of Object.entries(body)) results.push(...collectNestedCommentArrays(value, depth + 1, key, maxDepth));
  return results;
};

const collectCommentLikeObjects = (body: unknown, depth = 0, maxDepth = 4): unknown[] => {
  if (depth > maxDepth || !body || typeof body !== 'object') return [];
  const results: unknown[] = [];
  if (Array.isArray(body)) {
    for (const item of body) results.push(...collectCommentLikeObjects(item, depth + 1, maxDepth));
    return results;
  }
  if (isCommentLikeObject(body)) results.push(body);
  for (const value of Object.values(body)) results.push(...collectCommentLikeObjects(value, depth + 1, maxDepth));
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
  if (candidateArrays.some(Array.isArray)) return true;
  return collectNestedCommentArrays(body).length > 0;
};

export const parseAgentCommentsFromResponseBody = (
  body: unknown,
  seenCommentIdentifiers: Set<string> = new Set<string>(),
  eventType?: string,
): any[] => {
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
  for (const candidate of candidateArrays) if (Array.isArray(candidate)) rawComments.push(...candidate);
  if (rawComments.length === 0 && Array.isArray((body as any).data)) rawComments.push(...(body as any).data);
  const commentEventTypes = new Set(['actionComment', 'action_comment']);
  if (rawComments.length === 0 && eventType && commentEventTypes.has(eventType)) {
    const maybeComment = (body as any).data;
    if (maybeComment && isCommentLikeObject(maybeComment)) rawComments.push(maybeComment);
  }
  if (rawComments.length === 0) {
    for (const nested of collectNestedCommentArrays(body)) {
      if (Array.isArray(nested)) rawComments.push(...nested);
      else rawComments.push(nested);
    }
  }
  if (rawComments.length === 0) {
    rawComments.push(...collectCommentLikeObjects(body));
  }
  const comments: any[] = [];
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

  // Do not synthesize placeholder comments here. If no bodies were
  // extractable, return an empty array so higher-level logic can attempt
  // polling / Playwright enrichment or simply treat there being no usable
  // comment bodies. Synthesizing "(コメントあり)" caused downstream
  // confusion by appearing like a real user comment.
  // (Intentionally leave comments empty if none found.)
  return comments;
};

export const getCommentTextFromAgentComment = (comment: unknown): string | null => {
  if (!comment || typeof comment !== 'object') return null;
  const value = (comment as any).data ?? comment;
  const text = typeof value?.comment === 'string'
    ? value.comment
    : typeof value?.text === 'string'
      ? value.text
      : typeof value?.body === 'string'
        ? value.body
        : typeof value?.message === 'string'
          ? value.message
          : typeof value?.content === 'string'
            ? value.content
            : undefined;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed === '(コメントあり)') return null;
  return trimmed;
};

export const filterAgentCommentsWithText = (comments: AgentComment[]): AgentComment[] =>
  comments.filter((comment) => getCommentTextFromAgentComment(comment) !== null);
