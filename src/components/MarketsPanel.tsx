"use client";

import { useState, useMemo, useEffect, memo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { ProcessedMarket, Category } from "@/types";
import MarketCard from "./MarketCard";
import FilterDropdown, { FilterGroup } from "./FilterDropdown";
import { CATEGORY_COLORS } from "@/lib/categories";
import { getCountryFlag } from "@/lib/countries";
import { formatVolume } from "@/lib/format";
import { useColResize } from "@/hooks/useColResize";
import { useRowResize } from "@/hooks/useRowResize";
import type { PanelDragHandleProps } from "@/components/panelDragTypes";
import { useI18n } from "@/i18n";
import { localizeMarket } from "@/hooks/useLocalizedMarket";

interface MarketsPanelProps {
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
  activeCategories: Set<Category>;
  onFlyTo: (coords: [number, number], marketId: string) => void;
  onSelectMarket: (m: ProcessedMarket) => void;
  loading?: boolean;
  externalSearch?: string;
  isWatched?: (id: string) => boolean;
  onToggleWatch?: (id: string) => void;
  colSpan?: number;
  onColSpanChange?: (span: number) => void;
  onColSpanReset?: () => void;
  rowSpan?: number;
  onRowSpanChange?: (span: number) => void;
  onRowSpanReset?: () => void;
  maxColSpan?: number;
  selectedMarketId?: string | null;
  onTrade?: (state: import("./TradeModal").TradeModalState) => void;
  dragRootRef?: React.Ref<HTMLDivElement>;
  dragHandleProps?: PanelDragHandleProps;
  dragStyle?: React.CSSProperties;
  dragClassName?: string;
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  (ref as React.MutableRefObject<T | null>).current = value;
}

type SortOrder = "sections" | "volume" | "impact" | "change" | "new";
const CATEGORIES: Category[] = ["Politics", "Crypto", "Sports", "Finance", "Tech", "Culture", "Other"];
const NEW_THRESHOLD_MS = 6 * 60 * 60 * 1000;

function MarketsPanelInner({
  mapped,
  unmapped,
  activeCategories,
  onFlyTo,
  onSelectMarket,
  loading,
  externalSearch,
  isWatched,
  onToggleWatch,
  colSpan,
  onColSpanChange,
  onColSpanReset,
  rowSpan,
  onRowSpanChange,
  onRowSpanReset,
  maxColSpan,
  selectedMarketId,
  onTrade,
  dragRootRef,
  dragHandleProps,
  dragStyle,
  dragClassName,
}: MarketsPanelProps) {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState("");
  const [renderNow] = useState(() => Date.now());
  const [localCategoryFilter, setLocalCategoryFilter] = useState<Set<string>>(new Set());
  const [localSortSet, setLocalSortSet] = useState<Set<string>>(new Set(["impact"]));
  const sortHydrated = useRef(false);
  useEffect(() => {
    if (sortHydrated.current) return;
    sortHydrated.current = true;
    const saved = localStorage.getItem("pw:marketSort");
    if (saved && ["sections", "volume", "impact", "change", "new"].includes(saved)) {
      setLocalSortSet(new Set([saved]));
    }
  }, []);

  // Sync external search (e.g. tag click from detail panel)
  useEffect(() => {
    if (externalSearch === undefined) return;
    const timer = window.setTimeout(() => {
      setSearch(externalSearch);
    }, 0);
    return () => window.clearTimeout(timer);
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

  const sortOrder: SortOrder = ([...localSortSet][0] as SortOrder) || "impact";

  useEffect(() => {
    try { localStorage.setItem("pw:marketSort", sortOrder); } catch {}
  }, [sortOrder]);

  const effectiveCategories = useMemo(
    () => localCategoryFilter.size > 0 ? localCategoryFilter as Set<Category> : activeCategories,
    [localCategoryFilter, activeCategories]
  );

  const all = useMemo(() => [...mapped, ...unmapped], [mapped, unmapped]);
  const filtered = useMemo(
    () => all.filter((m) => effectiveCategories.has(m.category)),
    [all, effectiveCategories]
  );

  const searchFiltered = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return filtered.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.titleZh && m.titleZh.toLowerCase().includes(q)) ||
        (m.location && m.location.toLowerCase().includes(q)) ||
        m.category.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [filtered, search]);

  const newMarkets = useMemo(
    () =>
      (searchFiltered || filtered)
        .filter(
          (m) =>
            m.createdAt &&
            renderNow - new Date(m.createdAt).getTime() < NEW_THRESHOLD_MS
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
        )
        .slice(0, 10),
    [searchFiltered, filtered, renderNow]
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

  const sortedAll = useMemo(() => {
    if (sortOrder === "sections") return null;
    const base = [...(searchFiltered || filtered)].filter((m) => !m.closed);
    if (sortOrder === "impact") return base.sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0)).slice(0, 30);
    if (sortOrder === "volume") return base.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0)).slice(0, 30);
    if (sortOrder === "change") return base.filter((m) => m.change !== null).sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!)).slice(0, 30);
    if (sortOrder === "new") return base.filter((m) => m.createdAt).sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()).slice(0, 30);
    return null;
  }, [sortOrder, searchFiltered, filtered]);

  // Country hover popup
  const [countryPopup, setCountryPopup] = useState<{ name: string; rect: DOMRect } | null>(null);
  const locationHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countryHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLocationHover = useCallback((location: string, rect: DOMRect) => {
    if (locationHoverTimer.current) clearTimeout(locationHoverTimer.current);
    if (countryHideTimer.current) clearTimeout(countryHideTimer.current);
    locationHoverTimer.current = setTimeout(() => setCountryPopup({ name: location, rect }), 700);
  }, []);

  const handleLocationLeave = useCallback(() => {
    if (locationHoverTimer.current) clearTimeout(locationHoverTimer.current);
    countryHideTimer.current = setTimeout(() => setCountryPopup(null), 300);
  }, []);

  const handlePopupEnter = useCallback(() => {
    if (countryHideTimer.current) clearTimeout(countryHideTimer.current);
  }, []);

  const handlePopupLeave = useCallback(() => {
    countryHideTimer.current = setTimeout(() => setCountryPopup(null), 150);
  }, []);

  const countryStats = useMemo(() => {
    if (!countryPopup) return null;
    const loc = countryPopup.name.toLowerCase();
    const markets = all.filter((m) => (m.location || m.category).toLowerCase() === loc);
    const active = markets.filter((m) => !m.closed);
    return {
      flag: getCountryFlag(countryPopup.name),
      count: markets.length,
      activeCount: active.length,
      volume: markets.reduce((s, m) => s + m.volume, 0),
      volume24h: markets.reduce((s, m) => s + (m.volume24h || 0), 0),
      topMarket: active.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))[0] ?? null,
    };
  }, [countryPopup, all]);

  const cardAction = (m: ProcessedMarket) => {
    if (m.coords) onFlyTo(m.coords, m.id);
    onSelectMarket(m);
  };

  const watchProps = (m: ProcessedMarket) =>
    isWatched && onToggleWatch
      ? { isWatched: isWatched(m.id), onToggleWatch: () => onToggleWatch(m.id) }
      : {};

  const locationProps = { onLocationHover: handleLocationHover, onLocationLeave: handleLocationLeave, onTrade };

  const { onMouseDown: handleResizeStart } = useColResize(colSpan ?? 2, onColSpanChange, maxColSpan);
  const { onMouseDown: handleRowResizeStart } = useRowResize(rowSpan ?? 2, onRowSpanChange);
  const {
    ref: dragHandleRef,
    className: dragHandleClassName,
    ...dragHandleRest
  } = dragHandleProps ?? {};
  const setDragHandleRef = useCallback((node: HTMLElement | null) => {
    assignRef(dragHandleRef, node);
  }, [dragHandleRef]);

  const spanStyle: React.CSSProperties = {};
  if (colSpan && colSpan > 1) spanStyle.gridColumn = `span ${colSpan}`;
  if (rowSpan && rowSpan !== 2) spanStyle.gridRow = `span ${rowSpan}`;
  if (dragStyle) Object.assign(spanStyle, dragStyle);

  return (
    <div
      ref={dragRootRef}
      data-panel="markets"
      className={`panel${colSpan === 2 ? " panel-wide" : ""}${expanded ? " panel-expanded" : ""}${dragClassName ? ` ${dragClassName}` : ""}`}
      style={spanStyle}
    >
      <div className="panel-header">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            ref={setDragHandleRef}
            className={`drag-handle${dragHandleClassName ? ` ${dragHandleClassName}` : ""}`}
            title={t("common.dragToReorder")}
            {...dragHandleRest}
          >
            <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor">
              <circle cx="1" cy="1" r="1" /><circle cx="5" cy="1" r="1" />
              <circle cx="1" cy="5" r="1" /><circle cx="5" cy="5" r="1" />
              <circle cx="1" cy="9" r="1" /><circle cx="5" cy="9" r="1" />
            </svg>
          </span>
          <span className="panel-title">{t("panels.markets")}</span>
          {/* Search input */}
          <div className="relative min-w-[60px] max-w-[110px] flex-1 shrink">
            <svg
              className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
              width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
            >
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3 3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("common.search")}
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] font-mono py-0.5 pl-6 pr-5 placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[var(--scrollbar-thumb)] transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-secondary)] text-[11px]"
              >
                ×
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <FilterDropdown
              label={sortOrder === "volume" ? t("marketsPanel.volume") : sortOrder === "impact" ? t("marketsPanel.impact") : sortOrder === "change" ? t("marketsPanel.change") : sortOrder === "new" ? t("marketsPanel.newest") : t("marketsPanel.sections")}
              groups={[
              {
                label: t("marketsPanel.category"),
                options: CATEGORIES.map((cat) => ({ key: cat, label: cat, color: CATEGORY_COLORS[cat] })),
                selected: localCategoryFilter,
                onChange: setLocalCategoryFilter,
              },
              {
                label: t("marketsPanel.sort"),
                exclusive: true,
                options: [
                  { key: "impact", label: t("marketsPanel.impact") },
                  { key: "volume", label: t("marketsPanel.volume") },
                  { key: "change", label: t("marketsPanel.change") },
                  { key: "new", label: t("marketsPanel.newest") },
                  { key: "sections", label: t("marketsPanel.sections") },
                ],
                selected: localSortSet,
                onChange: setLocalSortSet,
              },
            ] satisfies FilterGroup[]} />
          </div>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="panel-expand-btn"
          title={expanded ? t("common.exitFullscreen") : t("common.fullscreen")}
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
      <div className="panel-content">
        {/* Skeleton loading */}
        {loading && mapped.length === 0 && (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {sortedAll ? (
          <>
            {sortedAll.length === 0 ? (
              <div className="text-[12px] text-[var(--text-ghost)] py-2 font-mono">{t("common.noData")}</div>
            ) : (
              sortedAll.map((m) => (
                <MarketCard key={m.id} market={m} showChange selected onClick={() => cardAction(m)} {...watchProps(m)} {...locationProps} />
              ))
            )}
          </>
        ) : (
          <>
            {/* Search results */}
            {searchFiltered ? (
              <>
                <SectionLabel title={t("marketsPanel.resultsCount", { count: searchFiltered.length })} />
                {searchFiltered.length === 0 ? (
                  <div className="text-[12px] text-[var(--text-ghost)] py-2 font-mono">{t("marketsPanel.noMarketsMatch")}</div>
                ) : (
                  searchFiltered.slice(0, 30).map((m) => (
                    <MarketCard key={m.id} market={m} showChange selected onClick={() => cardAction(m)} {...watchProps(m)} {...locationProps} />
                  ))
                )}
              </>
            ) : (
              <>
                {newMarkets.length > 0 && (
                  <>
                    <SectionLabel title={t("marketsPanel.newMarkets")} />
                    {newMarkets.map((m) => (
                      <MarketCard key={m.id} market={m} showChange selected onClick={() => cardAction(m)} {...watchProps(m)} {...locationProps} />
                    ))}
                  </>
                )}

                <SectionLabel title={t("marketsPanel.movers24h")} />
                {movers.length === 0 ? (
                  <div className="text-[12px] text-[var(--text-ghost)] py-2 font-mono">{t("common.noData")}</div>
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
                      <MarketCard market={m} showChange selected onClick={() => cardAction(m)} {...watchProps(m)} {...locationProps} />
                      {m.indicators && (
                        <div className="flex items-center gap-2 px-2.5 pb-1 -mt-0.5 text-[9px] font-mono text-[var(--text-faint)]">
                          {m.indicators.momentum !== null && (
                            <span title={`Momentum: ${(m.indicators.momentum * 100).toFixed(2)}%`}>
                              <span style={{ color: m.indicators.momentum > 0.01 ? "#22c55e" : m.indicators.momentum < -0.01 ? "#ff4444" : "var(--text-ghost)" }}>
                                {m.indicators.momentum > 0.01 ? "\u2191\u2191" : m.indicators.momentum > 0 ? "\u2191" : m.indicators.momentum < -0.01 ? "\u2193\u2193" : m.indicators.momentum < 0 ? "\u2193" : "\u2192"}
                              </span>
                            </span>
                          )}
                          {m.indicators.volatility !== null && m.indicators.volatility > 0.02 && (
                            <span style={{ color: "#f59e0b" }} title={`Volatility: ${(m.indicators.volatility * 100).toFixed(1)}%`}>
                              vol {(m.indicators.volatility * 100).toFixed(1)}%
                            </span>
                          )}
                          {m.indicators.orderFlowImbalance !== null && Math.abs(m.indicators.orderFlowImbalance) > 0.1 && (
                            <span style={{ color: m.indicators.orderFlowImbalance > 0 ? "#22c55e" : "#ff4444" }} title={`Order flow: ${(m.indicators.orderFlowImbalance * 100).toFixed(0)}%`}>
                              flow {m.indicators.orderFlowImbalance > 0 ? "+" : ""}{(m.indicators.orderFlowImbalance * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}

                <SectionLabel title={t("marketsPanel.trendingByVolume")} />
                {trending.length === 0 ? (
                  <div className="text-[12px] text-[var(--text-ghost)] py-2 font-mono">{t("common.noData")}</div>
                ) : (
                  trending.map((m) => (
                    <MarketCard key={m.id} market={m} showChange selected onClick={() => cardAction(m)} {...watchProps(m)} {...locationProps} />
                  ))
                )}

                {global.length > 0 && (
                  <>
                    <SectionLabel title={t("marketsPanel.globalMarkets")} />
                    {global.map((m) => (
                      <MarketCard key={m.id} market={m} showChange selected onClick={() => cardAction(m)} {...watchProps(m)} {...locationProps} />
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Country hover popup */}
      {countryPopup && countryStats && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[9999] bg-[var(--bg)] border border-[var(--border)] rounded-md font-mono"
          style={{
            top: Math.min(countryPopup.rect.bottom + 6, window.innerHeight - 160),
            left: Math.min(countryPopup.rect.left, window.innerWidth - 220),
            width: 210,
            padding: "10px 12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
          onMouseEnter={handlePopupEnter}
          onMouseLeave={handlePopupLeave}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[16px] leading-none">{countryStats.flag}</span>
            <span className="text-[11px] text-[var(--text)] capitalize">{countryPopup.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
            <span className="text-[var(--text-faint)]">{t("common.markets")}</span>
            <span className="text-[var(--text-secondary)] tabular-nums">{countryStats.count}</span>
            <span className="text-[var(--text-faint)]">{t("common.active")}</span>
            <span className="text-[var(--text-secondary)] tabular-nums">{countryStats.activeCount}</span>
            <span className="text-[var(--text-faint)]">{t("marketsPanel.volume").toLowerCase()}</span>
            <span className="text-[var(--text-secondary)] tabular-nums">{formatVolume(countryStats.volume)}</span>
            <span className="text-[var(--text-faint)]">{t("marketsPanel.vol24hLabel")}</span>
            <span className="text-[var(--text-secondary)] tabular-nums">{formatVolume(countryStats.volume24h)}</span>
          </div>
          {countryStats.topMarket && (
            <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
              <div className="text-[9px] text-[var(--text-faint)] uppercase tracking-wider mb-0.5">{t("marketsPanel.topMarket")}</div>
              <div className="text-[10px] text-[var(--text-dim)] line-clamp-2 leading-snug">{localizeMarket(countryStats.topMarket, locale).title}</div>
            </div>
          )}
        </div>,
        document.body
      )}

      {/* Right-edge resize handle */}
      {onColSpanChange && !expanded && (
        <div
          className="panel-col-resize-handle"
          onMouseDown={handleResizeStart}
          onDoubleClick={onColSpanReset}
          title={t("common.dragToResize")}
        >
          <div className="panel-col-resize-bar" />
        </div>
      )}

      {/* Bottom-edge resize handle */}
      {onRowSpanChange && !expanded && (
        <div
          className="panel-row-resize-handle"
          onMouseDown={handleRowResizeStart}
          onDoubleClick={onRowSpanReset}
          title={t("common.dragToResizeHeight")}
        >
          <div className="panel-row-resize-bar" />
        </div>
      )}
    </div>
  );
}

export default memo(MarketsPanelInner, (prev, next) => {
  if (prev.mapped !== next.mapped) return false;
  if (prev.unmapped !== next.unmapped) return false;
  if (prev.activeCategories !== next.activeCategories) return false;
  if (prev.loading !== next.loading) return false;
  if (prev.externalSearch !== next.externalSearch) return false;
  if (prev.colSpan !== next.colSpan) return false;
  if (prev.rowSpan !== next.rowSpan) return false;
  if (prev.maxColSpan !== next.maxColSpan) return false;
  if (prev.isWatched !== next.isWatched) return false;
  if (prev.dragRootRef !== next.dragRootRef) return false;
  if (prev.dragHandleProps !== next.dragHandleProps) return false;
  if (prev.dragStyle !== next.dragStyle) return false;
  if (prev.dragClassName !== next.dragClassName) return false;
  return true;
});

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
