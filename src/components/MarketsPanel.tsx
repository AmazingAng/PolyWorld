"use client";

import { useState, useMemo, useEffect } from "react";
import { ProcessedMarket, Category } from "@/types";
import MarketCard from "./MarketCard";

interface MarketsPanelProps {
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
  activeCategories: Set<Category>;
  onFlyTo: (coords: [number, number], marketId: string) => void;
  onSelectMarket: (m: ProcessedMarket) => void;
  loading?: boolean;
  externalSearch?: string;
}

type SortTab = "default" | "impact";
const NEW_THRESHOLD_MS = 6 * 60 * 60 * 1000;

export default function MarketsPanel({
  mapped,
  unmapped,
  activeCategories,
  onFlyTo,
  onSelectMarket,
  loading,
  externalSearch,
}: MarketsPanelProps) {
  const [search, setSearch] = useState("");
  const [sortTab, setSortTab] = useState<SortTab>("default");

  // Sync external search (e.g. tag click from detail panel)
  useEffect(() => {
    if (externalSearch !== undefined) setSearch(externalSearch);
  }, [externalSearch]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [expanded]);

  const all = useMemo(() => [...mapped, ...unmapped], [mapped, unmapped]);
  const filtered = useMemo(
    () => all.filter((m) => activeCategories.has(m.category)),
    [all, activeCategories]
  );

  const searchFiltered = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return filtered.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.location && m.location.toLowerCase().includes(q)) ||
        m.category.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [filtered, search]);

  const now = Date.now();
  const newMarkets = useMemo(
    () =>
      (searchFiltered || filtered)
        .filter(
          (m) =>
            m.createdAt &&
            now - new Date(m.createdAt).getTime() < NEW_THRESHOLD_MS
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
        )
        .slice(0, 10),
    [searchFiltered, filtered, now]
  );

  const movers = useMemo(
    () =>
      (searchFiltered || filtered)
        .filter((i) => i.change !== null && !isNaN(i.change!))
        .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))
        .slice(0, 10),
    [searchFiltered, filtered]
  );

  const trending = useMemo(
    () =>
      [...(searchFiltered || filtered)]
        .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
        .slice(0, 10),
    [searchFiltered, filtered]
  );

  const global = useMemo(
    () =>
      searchFiltered
        ? []
        : [...unmapped]
            .filter((m) => activeCategories.has(m.category))
            .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
            .slice(0, 8),
    [searchFiltered, unmapped, activeCategories]
  );

  const impactSorted = useMemo(
    () =>
      [...(searchFiltered || filtered)]
        .sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0))
        .slice(0, 20),
    [searchFiltered, filtered]
  );

  const cardAction = (m: ProcessedMarket) => {
    if (m.coords) onFlyTo(m.coords, m.id);
    onSelectMarket(m);
  };

  const totalCount = searchFiltered ? searchFiltered.length : filtered.length;

  return (
    <div data-panel="markets" className={`panel panel-wide${expanded ? " panel-expanded" : ""}`}>
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <span className="drag-handle" title="Drag to reorder">
            <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor">
              <circle cx="1" cy="1" r="1" /><circle cx="5" cy="1" r="1" />
              <circle cx="1" cy="5" r="1" /><circle cx="5" cy="5" r="1" />
              <circle cx="1" cy="9" r="1" /><circle cx="5" cy="9" r="1" />
            </svg>
          </span>
          <span className="panel-title">Markets</span>
          <span className="panel-count">{totalCount}</span>
        </div>
        {/* Search input in header */}
        <div className="relative flex-1 max-w-[200px]">
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
            width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3 3" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search..."
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[12px] text-[var(--text-secondary)] font-mono py-1 pl-8 pr-2 placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[var(--scrollbar-thumb)] transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-secondary)] text-[12px]"
            >
              x
            </button>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="panel-expand-btn"
          title={expanded ? "Exit fullscreen" : "Fullscreen"}
        >
          {expanded ? (
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="4 14 4 10 0 10" />
              <polyline points="12 2 12 6 16 6" />
              <line x1="0" y1="16" x2="6" y2="10" />
              <line x1="16" y1="0" x2="10" y2="6" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="10 2 14 2 14 6" />
              <polyline points="6 14 2 14 2 10" />
              <line x1="14" y1="2" x2="9" y2="7" />
              <line x1="2" y1="14" x2="7" y2="9" />
            </svg>
          )}
        </button>
      </div>
      {/* Sort tabs */}
      <div className="flex items-center gap-0.5 px-2 py-0.5 border-b border-[var(--border-subtle)]">
        {(["default", "impact"] as SortTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setSortTab(tab)}
            className={`px-1.5 py-0.5 text-[10px] font-mono transition-colors ${
              sortTab === tab
                ? "text-[var(--text)] bg-[var(--surface-hover)]"
                : "text-[var(--text-faint)] hover:text-[var(--text-muted)]"
            }`}
          >
            {tab === "default" ? "Default" : "Impact"}
          </button>
        ))}
      </div>
      <div className="panel-content">
        {/* Skeleton loading */}
        {loading && mapped.length === 0 && (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Impact tab */}
        {sortTab === "impact" ? (
          <>
            <SectionLabel title="By Impact Score" />
            {impactSorted.length === 0 ? (
              <div className="text-[12px] text-[var(--text-ghost)] py-2 font-mono">no data</div>
            ) : (
              impactSorted.map((m) => (
                <MarketCard key={m.id} market={m} showChange onClick={() => cardAction(m)} />
              ))
            )}
          </>
        ) : (
          <>
            {/* Search results */}
            {searchFiltered ? (
              <>
                <SectionLabel title={`Results (${searchFiltered.length})`} />
                {searchFiltered.length === 0 ? (
                  <div className="text-[12px] text-[var(--text-ghost)] py-2 font-mono">no markets match</div>
                ) : (
                  searchFiltered.slice(0, 30).map((m) => (
                    <MarketCard key={m.id} market={m} showChange onClick={() => cardAction(m)} />
                  ))
                )}
              </>
            ) : (
              <>
                {newMarkets.length > 0 && (
                  <>
                    <SectionLabel title="New Markets" />
                    {newMarkets.map((m) => (
                      <MarketCard key={m.id} market={m} showChange onClick={() => cardAction(m)} />
                    ))}
                  </>
                )}

                <SectionLabel title="24h Movers" />
                {movers.length === 0 ? (
                  <div className="text-[12px] text-[var(--text-ghost)] py-2 font-mono">no data</div>
                ) : (
                  movers.map((m) => (
                    <div key={m.id} className="relative">
                      {m.anomaly?.isAnomaly && (
                        <span
                          className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full z-10"
                          style={{ background: "#f59e0b" }}
                          title={`Anomaly z=${m.anomaly.zScore}`}
                        />
                      )}
                      <MarketCard market={m} showChange onClick={() => cardAction(m)} />
                    </div>
                  ))
                )}

                <SectionLabel title="Trending by Volume" />
                {trending.length === 0 ? (
                  <div className="text-[12px] text-[var(--text-ghost)] py-2 font-mono">no data</div>
                ) : (
                  trending.map((m) => (
                    <MarketCard key={m.id} market={m} showChange onClick={() => cardAction(m)} />
                  ))
                )}

                {global.length > 0 && (
                  <>
                    <SectionLabel title="Global Markets" />
                    {global.map((m) => (
                      <MarketCard key={m.id} market={m} showChange onClick={() => cardAction(m)} />
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ title }: { title: string }) {
  return (
    <h3 className="text-[10px] font-mono uppercase tracking-[1px] text-[var(--text-faint)] mb-1 mt-3 first:mt-0">
      {title}
    </h3>
  );
}

function SkeletonCard() {
  return (
    <div className="border border-[var(--border-subtle)] px-2.5 py-1.5 mb-1 animate-pulse">
      <div className="h-2 w-20 bg-[var(--border-subtle)] rounded-sm mb-2" />
      <div className="h-2.5 w-full bg-[var(--border-subtle)] rounded-sm mb-1" />
      <div className="h-2.5 w-3/4 bg-[var(--border-subtle)] rounded-sm mb-2" />
      <div className="flex justify-between">
        <div className="h-2.5 w-12 bg-[var(--border-subtle)] rounded-sm" />
        <div className="h-2.5 w-16 bg-[var(--border-subtle)] rounded-sm" />
      </div>
    </div>
  );
}
