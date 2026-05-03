import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStateResponse } from "./types";
import { createSpeechHistoryDisplayItems } from "./agentStatusUtils";

type SpeechHistoryDisplayItem = {
  id: string;
  speechText: string;
  displayLine: string;
  nGramLabel: string;
  nodes?: string[];
};

const EMPHASIZED_SPEECH_HISTORY_BORDER_BOTTOM_WIDTH = "3px";
const FETCH_PAGE_SIZE = 10;
const SPEECH_HISTORY_API_PATH = "/console/api/speech-history";

type SpeechHistoryListProps = {
  initialItems: SpeechHistoryDisplayItem[];
  emphasizeLatest: boolean;
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
export const SpeechHistoryList = ({ initialItems, emphasizeLatest }: SpeechHistoryListProps) => {
  const [olderItems, setOlderItems] = useState<SpeechHistoryDisplayItem[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pendingNewCount, setPendingNewCount] = useState(0);

  const isAtTopRef = useRef(true);
  const prevFirstItemIdRef = useRef<string | undefined>(initialItems[0]?.id);

  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);

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
  const fetchMoreItemsFn = async () => {
    if (isLoadingMore || !hasMore) return;

    const allItems = [...initialItems, ...olderItems];
    const oldestItem = allItems[allItems.length - 1];
    if (!oldestItem) return;

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
      setIsLoadingMore(false);
    }
  };

  const fetchMoreItemsRef = useRef(fetchMoreItemsFn);
  fetchMoreItemsRef.current = fetchMoreItemsFn;

  // Attach the IntersectionObserver once and invoke the latest fetch callback via ref.
  useEffect(() => {
    const bottomSentinel = bottomSentinelRef.current;
    if (!bottomSentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void fetchMoreItemsRef.current();
        }
      },
      { threshold: 0 },
    );
    observer.observe(bottomSentinel);
    return () => observer.disconnect();
  }, []);

  const handleScrollToTop = useCallback(() => {
    // Walk up the DOM to find the nearest scrollable ancestor and scroll it to the top.
    let node: Element | null = topSentinelRef.current?.parentElement ?? null;
    while (node) {
      const overflowY = window.getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        node.scrollTo({ top: 0, behavior: "smooth" });
        break;
      }
      node = node.parentElement;
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

  return (
    <div className="relative">
      {pendingNewCount > 0 ? (
        <button
          type="button"
          onClick={handleScrollToTop}
          className="sticky top-0 z-10 w-full mb-2 py-1 px-2 text-xs text-center bg-emerald-800/90 text-emerald-100 rounded border border-emerald-300/50 hover:bg-emerald-700/90 cursor-pointer"
        >
          ↑ 新しい発話が {pendingNewCount} 件あります
        </button>
      ) : null}
      <div ref={topSentinelRef} aria-hidden="true" className="h-0" />
      <ul className="grid grid-cols-1 gap-2" style={{ scrollbarWidth: "thin" }}>
        {allItems.map((speechHistoryItem, index) => (
          <li
            key={speechHistoryItem.id}
            className={index === 0 && emphasizeLatest
              ? "rounded-md border border-emerald-300/30 border-b border-b-emerald-300/80 p-2"
              : "rounded-md border border-emerald-300/30 p-2"
            }
            style={index === 0 && emphasizeLatest ? {
              "--speech-history-border-bottom-width": EMPHASIZED_SPEECH_HISTORY_BORDER_BOTTOM_WIDTH,
              borderBottomWidth: "var(--speech-history-border-bottom-width)",
              paddingBottom: "calc(0.5rem - var(--speech-history-border-bottom-width))",
            } as React.CSSProperties : undefined}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-2">
              <div className="flex flex-wrap gap-1">
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
              <button
                type="button"
                disabled
                aria-label="学習の取り消し"
                title="学習の取り消し"
                className="inline-flex items-center justify-center h-7 min-w-[2rem] rounded-md border border-emerald-300/50 bg-emerald-950/20 px-2 text-sm text-emerald-200 opacity-70 cursor-not-allowed shadow-sm shadow-black/20"
                style={{
                  fontFamily: "ui-sans-serif, system-ui, sans-serif",
                  fontVariantEmoji: "text",
                }}
              >
                ↩
              </button>
            </div>
          </li>
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
