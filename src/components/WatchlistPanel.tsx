"use client";

import { useMemo } from "react";
import { ProcessedMarket } from "@/types";
import MarketCard from "./MarketCard";

interface WatchlistPanelProps {
  watchedIds: Set<string>;
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
  addedAt: Record<string, number>;
  onSelectMarket: (market: ProcessedMarket) => void;
  isWatched: (id: string) => boolean;
  onToggleWatch: (id: string) => void;
}

export default function WatchlistPanel({
  watchedIds,
  mapped,
  unmapped,
  addedAt,
  onSelectMarket,
  isWatched,
  onToggleWatch,
}: WatchlistPanelProps) {
  const watchedMarkets = useMemo(() => {
    if (watchedIds.size === 0) return [];
    const all = [...mapped, ...unmapped];
    return all
      .filter((m) => watchedIds.has(m.id))
      .sort((a, b) => (addedAt[b.id] || 0) - (addedAt[a.id] || 0));
  }, [watchedIds, mapped, unmapped, addedAt]);

  if (watchedIds.size === 0) {
    return (
      <div className="text-[12px] text-[var(--text-ghost)] font-mono py-8 text-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 text-[var(--text-faint)]">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
        </svg>
        no watchlist items yet
        <div className="text-[11px] text-[var(--text-faint)] mt-1">
          click the star on any market to add it here
        </div>
      </div>
    );
  }

  return (
    <div className="font-mono">
      {/* Market list */}
      {watchedMarkets.map((m) => (
        <MarketCard
          key={m.id}
          market={m}
          showChange
          onClick={() => onSelectMarket(m)}
          isWatched={isWatched(m.id)}
          onToggleWatch={() => onToggleWatch(m.id)}
        />
      ))}

      {/* Markets not found (deleted/expired) */}
      {watchedIds.size > watchedMarkets.length && (
        <div className="text-[11px] text-[var(--text-faint)] mt-2 px-1">
          {watchedIds.size - watchedMarkets.length} watched market(s) no longer available
        </div>
      )}
    </div>
  );
}
