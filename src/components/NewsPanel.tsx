"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { ProcessedMarket, NewsItem } from "@/types";
import { NEWS_SOURCES } from "@/lib/newsSources";

interface NewsPanelProps {
  selectedMarket: ProcessedMarket | null;
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

export default function NewsPanel({ selectedMarket }: NewsPanelProps) {
  const [items, setItems] = useState<(NewsItem & { relevance_score?: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    try {
      const params = selectedMarket ? `?marketId=${selectedMarket.id}` : "";
      const res = await fetch(`/api/news${params}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [selectedMarket]);

  useEffect(() => {
    setLoading(true);
    fetchNews();
    const timer = setInterval(fetchNews, 120_000); // refresh every 2 min
    return () => clearInterval(timer);
  }, [fetchNews]);

  const filteredItems = useMemo(() => {
    if (!sourceFilter) return items;
    return items.filter((item) => item.source === sourceFilter);
  }, [items, sourceFilter]);

  // Unique sources present in current items
  const activeSources = useMemo(() => {
    const set = new Set(items.map((i) => i.source));
    return NEWS_SOURCES.filter((s) => set.has(s.name));
  }, [items]);

  return (
    <div>
      {/* Source filter pills */}
      <div className="flex gap-1 flex-wrap mb-2">
        <button
          onClick={() => setSourceFilter(null)}
          className="text-[10px] font-mono px-1.5 py-0.5 border transition-colors"
          style={{
            borderColor: !sourceFilter ? "rgba(68,255,136,0.4)" : "var(--border)",
            color: !sourceFilter ? "var(--green)" : "var(--text-muted)",
            background: !sourceFilter ? "rgba(68,255,136,0.08)" : "transparent",
          }}
        >
          ALL
        </button>
        {activeSources.map((s) => (
          <button
            key={s.name}
            onClick={() => setSourceFilter(sourceFilter === s.name ? null : s.name)}
            className="text-[10px] font-mono px-1.5 py-0.5 border transition-colors"
            style={{
              borderColor: sourceFilter === s.name ? "rgba(68,255,136,0.4)" : "var(--border)",
              color: sourceFilter === s.name ? "var(--green)" : "var(--text-muted)",
              background: sourceFilter === s.name ? "rgba(68,255,136,0.08)" : "transparent",
            }}
          >
            {SOURCE_ABBREVS[s.name] || s.name.slice(0, 3).toUpperCase()}
          </button>
        ))}
      </div>

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

      {/* Empty state */}
      {!loading && filteredItems.length === 0 && (
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
            className="block border border-[var(--border-subtle)] px-2.5 py-1.5 transition-colors"
            style={{ textDecoration: "none" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
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
    </div>
  );
}
