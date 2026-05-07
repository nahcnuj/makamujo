/** @jsxImportSource hono/jsx */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "hono/jsx";
import type { CSSProperties } from "hono/jsx";
import type { AgentStateResponse } from "./types";
import { createSpeechHistoryDisplayItems } from "./agentStatusUtils";
import { NewItemsButton } from "./NewItemsButton";
import { UndoLearningButton } from "./UndoLearningButton";

type SpeechHistoryDisplayItem = {
  id: string;
  speechText: string;
  displayLine: string;
  nGramLabel: string;
  nodes?: string[];
  replyTargetComment?: {
    text?: string;
    pickedTopic?: string;
  };
};

const EMPHASIZED_SPEECH_HISTORY_BORDER_BOTTOM_WIDTH = "3px";
const FETCH_PAGE_SIZE = 10;
const SPEECH_HISTORY_API_PATH = "/console/api/speech-history";

type ReplyTargetComment = {
  text?: string;
  pickedTopic?: string;
};

type SpeechHistoryItemProps = {
  speechHistoryItem: SpeechHistoryDisplayItem;
  isFirst: boolean;
  emphasizeLatest: boolean;
  fallbackReplyTargetComment?: ReplyTargetComment;
  isFallbackReplyTarget?: boolean;
};

export const SpeechHistoryListItem = ({
  speechHistoryItem,
  isFirst,
  emphasizeLatest,
  fallbackReplyTargetComment,
  isFallbackReplyTarget,
}: SpeechHistoryItemProps) => {
  const replyComment = speechHistoryItem.replyTargetComment?.text
    ? speechHistoryItem.replyTargetComment
    : isFallbackReplyTarget && fallbackReplyTargetComment?.text
      ? fallbackReplyTargetComment
      : undefined;

  return (
    <li
      key={speechHistoryItem.id}
      className={isFirst && emphasizeLatest
        ? "rounded-sm border-b border-b-emerald-300/80 px-1"
        : "rounded-sm px-1"
      }
      style={isFirst && emphasizeLatest ? {
        "--speech-history-border-bottom-width": EMPHASIZED_SPEECH_HISTORY_BORDER_BOTTOM_WIDTH,
        borderBottomWidth: "var(--speech-history-border-bottom-width)",
        paddingBottom: "calc(0.2rem - var(--speech-history-border-bottom-width))",
      } as CSSProperties : undefined}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {replyComment?.text ? (
            <span className="text-xs text-emerald-300/60 break-words">
              {renderReplyAnnotation(replyComment.text, replyComment.pickedTopic)}
            </span>
          ) : null}
          {speechHistoryItem.nodes && Array.isArray(speechHistoryItem.nodes)
            ? speechHistoryItem.nodes.map((word, wi) => (
              <span
                key={`${speechHistoryItem.id}-node-${wi}`}
                className="speech-word-chip inline-block rounded-md border border-emerald-300/30 bg-emerald-950/40 px-2 py-1 text-sm"
              >
                {word}
              </span>
            ))
            : speechHistoryItem.speechText.split(/\s+/).map((word, wi) => (
              <span
                key={`${speechHistoryItem.id}-word-${wi}`}
                className="speech-word-chip inline-block rounded-md border border-emerald-300/30 bg-emerald-950/40 px-2 py-1 text-sm"
              >
                {word}
              </span>
            ))}
        </div>
        <span className="text-xs whitespace-nowrap">{speechHistoryItem.nGramLabel}</span>
        <UndoLearningButton />
      </div>
    </li>
  );
};

type SpeechHistoryListProps = {
  initialItems: SpeechHistoryDisplayItem[];
  emphasizeLatest: boolean;
  replyTargetComment?: ReplyTargetComment;
};

/**
 * Renders the speech history list with infinite scroll support.
 *
 * Displays `initialItems` (from SSE) at the top and loads older items via
 * `/console/api/speech-history` when the user scrolls to the bottom.
 *
 * When new speech arrives while the user has scrolled away from the top, a
 * sticky notification button appears at the top so the user can jump back
 * to the latest item without losing their scroll position.
 */
const renderReplyAnnotation = (text: string, pickedTopic: string | undefined) => {
  if (!pickedTopic) {
    return <span>{text}</span>;
  }
  const segments = text.split(pickedTopic).flatMap((segment, idx, arr) =>
    idx === arr.length - 1 ? [segment] : [segment, pickedTopic],
  );
  return (
    <>
      {segments.map((part, idx) =>
        idx % 2 === 1 ? (
          <span
            key={`reply-highlight-${idx}`}
            className="rounded bg-emerald-300/30 px-0.5 font-semibold text-emerald-100"
          >
            {part}
          </span>
        ) : (
          <span key={`reply-part-${idx}`}>{part}</span>
        ),
      )}
    </>
  );
};

export const SpeechHistoryList = ({ initialItems, emphasizeLatest, replyTargetComment }: SpeechHistoryListProps) => {
  const [olderItems, setOlderItems] = useState<SpeechHistoryDisplayItem[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pendingNewCount, setPendingNewCount] = useState(0);

  const isAtTopRef = useRef(true);
  const prevFirstItemIdRef = useRef<string | undefined>(initialItems[0]?.id);
  // Synchronous in-flight guard to prevent concurrent fetches when the
  // IntersectionObserver fires multiple times before React flushes setIsLoadingMore.
  const isFetchingRef = useRef(false);

  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  // Reference to the nearest scrollable ancestor; found once on mount.
  const scrollContainerRef = useRef<Element | null>(null);
  // scrollHeight of the scroll container from the most recent layout — used to
  // compute the height delta when new SSE items are prepended at the top.
  const prevScrollHeightRef = useRef(0);

  // Find and cache the nearest scrollable ancestor once after mount.
  // Also seed prevScrollHeightRef so the first SSE update has a valid baseline.
  useLayoutEffect(() => {
    let node: Element | null = topSentinelRef.current?.parentElement ?? null;
    while (node) {
      const overflowY = window.getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        scrollContainerRef.current = node;
        break;
      }
      node = node.parentElement;
    }
    prevScrollHeightRef.current = scrollContainerRef.current?.scrollHeight ?? 0;
  }, []);

  // Restore the scroll position when SSE prepends new items at the top while
  // the user is scrolled away from the top.
  //
  // Strategy: `prevScrollHeightRef` stores the scrollHeight captured at the END
  // of the previous layout — i.e., BEFORE the current DOM mutation. After React
  // commits the new DOM, we compute:
  //   delta = newScrollHeight − oldScrollHeight
  // and add delta to scrollTop so the currently-visible content stays in place.
  // We then store the new scrollHeight for the next update.
  //
  // This avoids reading DOM during render (which is unsafe in React 18 concurrent
  // mode) and is equivalent to the browser's native overflow-anchor behaviour.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;

    if (!container || isAtTopRef.current) {
      // User is at the top: no anchoring needed; just refresh the baseline.
      prevScrollHeightRef.current = container?.scrollHeight ?? prevScrollHeightRef.current;
      return;
    }

    // delta > 0 means items were prepended (scrollHeight grew without scrollTop changing).
    const delta = container.scrollHeight - (prevScrollHeightRef.current ?? 0);
    if (delta > 0) {
      container.scrollTop += delta;
    }
    prevScrollHeightRef.current = container.scrollHeight;
  }, [initialItems]);

  // Track whether the top of the speech history list is visible in the viewport.
  // When the user scrolls the containing <dl> card downward, the top sentinel
  // gets clipped by the overflow and leaves the viewport — this is when we treat
  // the user as "not at top" for notification purposes.
  useEffect(() => {
    const topSentinel = topSentinelRef.current;
    if (!topSentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry?.isIntersecting ?? true;
        isAtTopRef.current = visible;
        if (visible) {
          setPendingNewCount(0);
        }
      },
      { threshold: 0 },
    );
    observer.observe(topSentinel);
    return () => observer.disconnect();
  }, []);

  // Detect new items from SSE while the user is scrolled away from the top.
  useEffect(() => {
    const newFirstId = initialItems[0]?.id;
    if (newFirstId !== undefined && newFirstId !== prevFirstItemIdRef.current) {
      if (!isAtTopRef.current) {
        setPendingNewCount((n) => n + 1);
      }
      prevFirstItemIdRef.current = newFirstId;
    }
  }, [initialItems]);

  // Fetch older items via the pagination API.
  // Using a ref so the IntersectionObserver callback always calls the latest closure.
  const fetchMoreItems = async () => {
    // Synchronous ref guard prevents concurrent fetches when the observer fires
    // multiple times before React processes setIsLoadingMore(true).
    if (isFetchingRef.current || !hasMore) return;
    isFetchingRef.current = true;

    const allItems = [...initialItems, ...olderItems];
    const oldestItem = allItems[allItems.length - 1];
    if (!oldestItem) {
      isFetchingRef.current = false;
      return;
    }

    setIsLoadingMore(true);
    try {
      const url = new URL(SPEECH_HISTORY_API_PATH, window.location.origin);
      url.searchParams.set("before", oldestItem.id);
      url.searchParams.set("limit", String(FETCH_PAGE_SIZE));
      const response = await fetch(url.toString());
      if (!response.ok) return;

      const data = await response.json() as { items: AgentStateResponse["speechHistory"]; hasMore: boolean };
      const newItems = createSpeechHistoryDisplayItems(data.items);
      const existingIds = new Set([...initialItems.map((i) => i.id), ...olderItems.map((i) => i.id)]);
      setOlderItems((prev) => [...prev, ...newItems.filter((i) => !existingIds.has(i.id))]);
      setHasMore(data.hasMore);
    } catch {
      // Ignore transient fetch errors; the user can scroll again to retry.
    } finally {
      isFetchingRef.current = false;
      setIsLoadingMore(false);
    }
  };

  const fetchMoreItemsRef = useRef(fetchMoreItems);
  fetchMoreItemsRef.current = fetchMoreItems;

  // Attach the IntersectionObserver once and invoke the latest fetch callback via ref.
  useEffect(() => {
    const bottomSentinel = bottomSentinelRef.current;
    if (!bottomSentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void fetchMoreItemsRef.current?.();
        }
      },
      { threshold: 0 },
    );
    observer.observe(bottomSentinel);
    return () => observer.disconnect();
  }, []);

  const handleScrollToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: 0, behavior: "smooth" });
    }
    setPendingNewCount(0);
  }, []);

  // Deduplicate items (initialItems may overlap with olderItems after SSE updates).
  const seenIds = new Set<string>();
  const allItems = [...initialItems, ...olderItems].filter((item) => {
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  });

  const normalizedPickedTopic = replyTargetComment?.pickedTopic?.trim();
  const fallbackReplyTargetCommentIndex = normalizedPickedTopic
    ? allItems.findIndex((item) => item.speechText.startsWith(normalizedPickedTopic))
    : replyTargetComment?.text
      ? 0
      : -1;

  return (
    <div className="relative">
      {pendingNewCount > 0 ? (
        <NewItemsButton count={pendingNewCount} onClick={handleScrollToTop} />
      ) : null}
      <div ref={topSentinelRef} aria-hidden="true" className="h-0" />
      <ul className="grid grid-cols-1 gap-4" style={{ scrollbarWidth: "thin" }}>
        {allItems.map((speechHistoryItem, index) => (
          <SpeechHistoryListItem
            key={speechHistoryItem.id}
            speechHistoryItem={speechHistoryItem}
            isFirst={index === 0}
            emphasizeLatest={emphasizeLatest}
            fallbackReplyTargetComment={replyTargetComment}
            isFallbackReplyTarget={index === fallbackReplyTargetCommentIndex}
          />
        ))}
      </ul>
      <div ref={bottomSentinelRef} aria-hidden="true" className="h-4" />
      {isLoadingMore ? (
        <p className="text-xs text-center py-1 text-emerald-300/70">読み込み中...</p>
      ) : !hasMore && allItems.length > 0 ? (
        <p className="text-xs text-center py-1 text-emerald-300/50">すべての発話を表示しています</p>
      ) : null}
    </div>
  );
};

