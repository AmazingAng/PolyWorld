"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ProcessedMarket, TweetItem } from "@/types";
import { TWEET_SOURCES, HANDLE_ABBREVS } from "@/lib/tweetSources";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";

interface TweetsPanelProps {
  selectedMarket: ProcessedMarket | null;
  handleFilter: string | null;
  onHandlesChange?: (handles: string[]) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TweetPopover({
  item,
  anchorRect,
  selectedMarket,
  onMouseEnter,
  onMouseLeave,
}: {
  item: TweetItem;
  anchorRect: DOMRect;
  selectedMarket: ProcessedMarket | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const pos = useMemo(() => {
    const vw = window.innerWidth;
    const popoverWidth = 340;
    const gap = 6;
    let left: number;
    if (anchorRect.left - popoverWidth - gap > 0) {
      left = anchorRect.left - popoverWidth - gap;
    } else {
      left = anchorRect.right + gap;
    }
    if (left + popoverWidth > vw) left = vw - popoverWidth - 8;
    if (left < 8) left = 8;

    const vh = window.innerHeight;
    let top = anchorRect.top;
    if (top + 300 > vh) top = vh - 308;
    if (top < 8) top = 8;

    return { top, left };
  }, [anchorRect]);

  return (
    <div
      ref={popoverRef}
      className="tweet-popover"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Handle + time header */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-bold text-[var(--text-dim)]">
          @{item.handle}
        </span>
        <span className="text-[10px] text-[var(--text-ghost)]">
          {item.authorName}
        </span>
      </div>

      {/* Timestamp */}
      <div className="text-[10px] text-[var(--text-ghost)] mb-2">
        {formatDate(item.publishedAt)}
      </div>

      {/* Full tweet text */}
      <div className="text-[12px] leading-relaxed text-[var(--text)] whitespace-pre-line">
        {item.text}
      </div>

      {/* Relevance */}
      {selectedMarket && item.relevanceScore != null && (
        <div className="flex items-center gap-1.5 mt-2 pt-1.5 border-t border-[var(--border-subtle)]">
          <span className="text-[9px] text-[var(--text-faint)] uppercase">relevance</span>
          <div className="flex-1 h-[3px] bg-[var(--border)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round(item.relevanceScore * 100)}%`,
                background: "var(--green)",
              }}
            />
          </div>
          <span className="text-[9px] text-[var(--green)]">
            {Math.round(item.relevanceScore * 100)}%
          </span>
        </div>
      )}

      {/* Open link hint */}
      <div className="mt-2 pt-1.5 border-t border-[var(--border-subtle)]">
        <span className="text-[10px] text-[var(--text-faint)]">
          hover to read &middot; click card to open tweet &rarr;
        </span>
      </div>
    </div>
  );
}

export default function TweetsPanel({ selectedMarket, handleFilter, onHandlesChange }: TweetsPanelProps) {
  const [items, setItems] = useState<TweetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredItem, setHoveredItem] = useState<TweetItem | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);

  const showPopover = useCallback((item: TweetItem, rect: DOMRect) => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    setHoveredItem(item);
    setAnchorRect(rect);
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setHoveredItem(null);
      setAnchorRect(null);
    }, 200);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);

  const fetchTweets = useCallback(async () => {
    try {
      const params = selectedMarket ? `?marketId=${selectedMarket.id}` : "";
      const res = await fetch(`/api/tweets${params}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setItems(data);
      setError(null);
      retryCount.current = 0;
    } catch {
      if (retryCount.current < 3) {
        const delay = 2000 * Math.pow(2, retryCount.current);
        retryCount.current++;
        setTimeout(fetchTweets, delay);
      } else {
        setError("load failed");
      }
    } finally {
      setLoading(false);
    }
  }, [selectedMarket]);

  useEffect(() => {
    setLoading(true);
    fetchTweets();
  }, [fetchTweets]);

  useVisibilityPolling(fetchTweets, 90_000);

  const filteredItems = useMemo(() => {
    if (!handleFilter) return items;
    return items.filter((item) => item.handle === handleFilter);
  }, [items, handleFilter]);

  const activeHandles = useMemo(() => {
    const set = new Set(items.map((i) => i.handle));
    return TWEET_SOURCES.filter((s) => set.has(s.handle));
  }, [items]);

  // Notify parent of available handles for header dropdown
  useEffect(() => {
    onHandlesChange?.(activeHandles.map(s => s.handle));
  }, [activeHandles, onHandlesChange]);

  return (
    <div>

      {/* Loading skeleton */}
      {loading && items.length === 0 && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="border border-[var(--border-subtle)] p-3 animate-pulse">
              <div className="h-2 bg-[var(--border)] rounded w-1/4 mb-2" />
              <div className="h-3 bg-[var(--border)] rounded w-3/4 mb-1.5" />
              <div className="h-2 bg-[var(--border)] rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="text-[11px] text-[var(--red)] font-mono py-2 text-center" aria-live="polite">
          {error} <button onClick={() => { retryCount.current = 0; setLoading(true); fetchTweets(); }} className="ml-2 underline">retry</button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filteredItems.length === 0 && (
        <div className="text-[12px] text-[var(--text-muted)] font-mono py-4 text-center">
          {selectedMarket
            ? "no related tweets found for this market"
            : "no tweets available yet"}
        </div>
      )}

      {/* Tweet cards */}
      <div className="space-y-1">
        {filteredItems.map((item) => (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block border border-[var(--border-subtle)] px-2.5 py-1.5 transition-colors hover:bg-[var(--surface-hover)]"
            style={{ textDecoration: "none" }}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              showPopover(item, rect);
            }}
            onMouseLeave={scheduleHide}
          >
            {/* Handle + time */}
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[10px] font-mono font-bold" style={{ color: "var(--text-dim)" }}>
                @{item.handle}
              </span>
              <span className="text-[10px] font-mono" style={{ color: "var(--text-ghost)" }}>
                {timeAgo(item.publishedAt)}
              </span>
            </div>

            {/* Tweet text */}
            <div
              className="text-[12px] font-mono leading-tight mb-0.5"
              style={{
                color: "var(--text)",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {item.text}
            </div>

            {/* Relevance bar (only in market mode) */}
            {selectedMarket && item.relevanceScore != null && (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="flex-1 h-[3px] bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.round(item.relevanceScore * 100)}%`,
                      background: "var(--green)",
                    }}
                  />
                </div>
                <span className="text-[9px] font-mono" style={{ color: "var(--green)" }}>
                  {Math.round(item.relevanceScore * 100)}%
                </span>
              </div>
            )}
          </a>
        ))}
      </div>

      {/* Popover */}
      {hoveredItem && anchorRect && (
        <TweetPopover
          item={hoveredItem}
          anchorRect={anchorRect}
          selectedMarket={selectedMarket}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        />
      )}
    </div>
  );
}
