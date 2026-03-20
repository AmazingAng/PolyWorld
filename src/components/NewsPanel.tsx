"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ProcessedMarket, NewsItem } from "@/types";
import { NEWS_SOURCES } from "@/lib/newsSources";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";

interface NewsPanelProps {
  selectedMarket: ProcessedMarket | null;
  sourceFilter: Set<string>;
  onSourcesChange?: (sources: string[]) => void;
}

const SOURCE_ABBREVS: Record<string, string> = {
  Reuters: "R",
  "BBC World": "BBC",
  "Al Jazeera": "AJ",
  Bloomberg: "BL",
  "AP News": "AP",
  NPR: "NPR",
  "France 24": "F24",
  "DW News": "DW",
  CNBC: "CNBC",
  "The Guardian": "GU",
  "NHK World": "NHK",
  CNA: "CNA",
};

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

type ExtendedNewsItem = NewsItem & { relevance_score?: number };

function NewsPopover({
  item,
  anchorRect,
  selectedMarket,
  onMouseEnter,
  onMouseLeave,
}: {
  item: ExtendedNewsItem;
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
    let direction: "left" | "right";
    if (anchorRect.left - popoverWidth - gap > 0) {
      left = anchorRect.left - popoverWidth - gap;
      direction = "left";
    } else {
      left = anchorRect.right + gap;
      direction = "right";
    }
    // Clamp to viewport
    if (left + popoverWidth > vw) left = vw - popoverWidth - 8;
    if (left < 8) left = 8;

    // Vertically align to the anchor top, clamp to viewport
    const vh = window.innerHeight;
    let top = anchorRect.top;
    if (top + 300 > vh) top = vh - 308;
    if (top < 8) top = 8;

    return { top, left, direction };
  }, [anchorRect]);

  return (
    <div
      ref={popoverRef}
      className="news-popover"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Source + time header */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-bold uppercase text-[var(--text-dim)]">
          {item.source}
        </span>
        <span className="text-[10px] text-[var(--text-ghost)]">
          {formatDate(item.publishedAt)}
        </span>
      </div>

      {/* Title */}
      <div className="text-[12px] font-semibold leading-snug text-[var(--text)] mb-2">
        {item.title}
      </div>

      {/* Image */}
      {item.imageUrl && (
        <div className="mb-2 rounded overflow-hidden border border-[var(--border-subtle)]">
          <img
            src={item.imageUrl}
            alt=""
            className="w-full h-auto max-h-[140px] object-cover"
            loading="lazy"
          />
        </div>
      )}

      {/* Summary / content */}
      {item.summary && (
        <div className="text-[11px] leading-relaxed text-[var(--text-dim)] whitespace-pre-line">
          {item.summary}
        </div>
      )}

      {/* Relevance */}
      {selectedMarket && item.relevance_score != null && (
        <div className="flex items-center gap-1.5 mt-2 pt-1.5 border-t border-[var(--border-subtle)]">
          <span className="text-[9px] text-[var(--text-faint)] uppercase">relevance</span>
          <div className="flex-1 h-[3px] bg-[var(--border)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round(item.relevance_score * 100)}%`,
                background: "var(--green)",
              }}
            />
          </div>
          <span className="text-[9px] text-[var(--green)]">
            {Math.round(item.relevance_score * 100)}%
          </span>
        </div>
      )}

      {/* Categories */}
      {item.categories.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-2">
          {item.categories.map((cat, i) => (
            <span key={`${cat}-${i}`} className="text-[9px] px-1.5 py-0.5 border border-[var(--border)] text-[var(--text-faint)] rounded-sm">
              {cat}
            </span>
          ))}
        </div>
      )}

      {/* Read more link */}
      <div className="mt-2 pt-1.5 border-t border-[var(--border-subtle)]">
        <span className="text-[10px] text-[var(--text-faint)]">
          hover to read &middot; click card to open source &rarr;
        </span>
      </div>
    </div>
  );
}

export default function NewsPanel({ selectedMarket, sourceFilter, onSourcesChange }: NewsPanelProps) {
  const [items, setItems] = useState<ExtendedNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredItem, setHoveredItem] = useState<ExtendedNewsItem | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);

  const showPopover = useCallback((item: ExtendedNewsItem, rect: DOMRect) => {
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

  const fetchNews = useCallback(async () => {
    try {
      const params = selectedMarket ? `?marketId=${selectedMarket.id}` : "";
      const res = await fetch(`/api/news${params}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setItems(data);
      setError(null);
      retryCount.current = 0;
    } catch {
      if (retryCount.current < 3) {
        const delay = 2000 * Math.pow(2, retryCount.current);
        retryCount.current++;
        setTimeout(fetchNews, delay);
      } else {
        setError("load failed");
      }
    } finally {
      setLoading(false);
    }
  }, [selectedMarket]);

  useEffect(() => {
    setLoading(true);
    fetchNews();
  }, [fetchNews]);

  useVisibilityPolling(fetchNews, 120_000);

  const filteredItems = useMemo(() => {
    if (sourceFilter.size === 0) return items;
    return items.filter((item) => sourceFilter.has(item.source));
  }, [items, sourceFilter]);

  const activeSources = useMemo(() => {
    const set = new Set(items.map((i) => i.source));
    return NEWS_SOURCES.filter((s) => set.has(s.name));
  }, [items]);

  // Notify parent of available sources for header dropdown
  useEffect(() => {
    onSourcesChange?.(activeSources.map(s => s.name));
  }, [activeSources, onSourcesChange]);

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
          {error} <button onClick={() => { retryCount.current = 0; setLoading(true); fetchNews(); }} className="ml-2 underline">retry</button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filteredItems.length === 0 && (
        <div className="text-[12px] text-[var(--text-muted)] font-mono py-4 text-center">
          {selectedMarket
            ? "no related news found for this market"
            : "no news items available yet"}
        </div>
      )}

      {/* News cards */}
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
            {/* Source + time */}
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[10px] font-mono font-bold uppercase" style={{ color: "var(--text-dim)" }}>
                {item.source}
              </span>
              <span className="text-[10px] font-mono" style={{ color: "var(--text-ghost)" }}>
                {timeAgo(item.publishedAt)}
              </span>
            </div>

            {/* Title */}
            <div
              className="text-[12px] font-mono leading-tight mb-0.5"
              style={{
                color: "var(--text)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {item.title}
            </div>

            {/* Summary */}
            {item.summary && (
              <div
                className="text-[10px] font-mono leading-snug"
                style={{
                  color: "var(--text-muted)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {item.summary}
              </div>
            )}

            {/* Relevance bar (only in market mode) */}
            {selectedMarket && item.relevance_score != null && (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="flex-1 h-[3px] bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.round(item.relevance_score * 100)}%`,
                      background: "var(--green)",
                    }}
                  />
                </div>
                <span className="text-[9px] font-mono" style={{ color: "var(--green)" }}>
                  {Math.round(item.relevance_score * 100)}%
                </span>
              </div>
            )}
          </a>
        ))}
      </div>

      {/* Popover — rendered via portal-like fixed positioning */}
      {hoveredItem && anchorRect && (
        <NewsPopover
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
