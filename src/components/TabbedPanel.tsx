"use client";

import { useState, useMemo } from "react";
import { ProcessedMarket, Category } from "@/types";
import MarketCard from "./MarketCard";
import MarketDetailPanel from "./MarketDetailPanel";
import CountryPanel from "./CountryPanel";
import SettingsPanel from "./SettingsPanel";
import LivePanel from "./LivePanel";
import type { TimeRange } from "./TimeRangeFilter";

interface TabbedPanelProps {
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
  activeCategories: Set<Category>;
  onToggleCategory: (cat: Category) => void;
  onFlyTo: (coords: [number, number], marketId: string) => void;
  selectedMarket: ProcessedMarket | null;
  onSelectMarket: (market: ProcessedMarket | null) => void;
  selectedCountry: string | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  loading?: boolean;
}

const TABS = [
  { id: "markets", label: "Markets" },
  { id: "detail", label: "Detail" },
  { id: "country", label: "Country" },
  { id: "live", label: "Live" },
  { id: "settings", label: "Settings" },
];

const NEW_THRESHOLD_MS = 6 * 60 * 60 * 1000;

export default function TabbedPanel({
  mapped,
  unmapped,
  activeCategories,
  onToggleCategory,
  onFlyTo,
  selectedMarket,
  onSelectMarket,
  selectedCountry,
  activeTab,
  onTabChange,
  timeRange,
  onTimeRangeChange,
  autoRefresh,
  onToggleAutoRefresh,
  loading,
}: TabbedPanelProps) {
  const handleMarketClick = (m: ProcessedMarket) => {
    onSelectMarket(m);
    onTabChange("detail");
    if (m.coords) onFlyTo(m.coords, m.id);
  };

  // Compute related markets for the detail panel
  const relatedMarkets = useMemo(() => {
    if (!selectedMarket) return [];
    const all = [...mapped, ...unmapped];
    return all
      .filter(
        (m) =>
          m.id !== selectedMarket.id &&
          (m.category === selectedMarket.category ||
            (selectedMarket.location && m.location === selectedMarket.location))
      )
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
      .slice(0, 5);
  }, [selectedMarket, mapped, unmapped]);

  return (
    <aside className="w-[340px] bg-[#0a0a0a] border-l border-[#1e1e1e] flex flex-col shrink-0 hidden md:flex">
      {/* Tab bar */}
      <div className="flex border-b border-[#1e1e1e] shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 py-1.5 text-[10px] font-mono tracking-wide transition-colors ${
              activeTab === tab.id
                ? "text-[#e8e8e8] bg-[#141414] border-b border-[#e8e8e8]"
                : "text-[#777] hover:text-[#a0a0a0] hover:bg-[#0e0e0e]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content with fade transition */}
      <div className="flex-1 overflow-y-auto scrollbar-thin animate-fade-in" key={activeTab}>
        {activeTab === "markets" && (
          <MarketsTab
            mapped={mapped}
            unmapped={unmapped}
            activeCategories={activeCategories}
            onFlyTo={onFlyTo}
            onSelectMarket={handleMarketClick}
            loading={loading}
          />
        )}

        {activeTab === "detail" && (
          selectedMarket ? (
            <div className="p-2">
              <MarketDetailPanel
                market={selectedMarket}
                relatedMarkets={relatedMarkets}
                onBack={() => {
                  onSelectMarket(null);
                  onTabChange("markets");
                }}
                onSelectMarket={handleMarketClick}
              />
            </div>
          ) : (
            <DetailEmptyState
              mapped={mapped}
              unmapped={unmapped}
              activeCategories={activeCategories}
              onSelectMarket={handleMarketClick}
            />
          )
        )}

        {activeTab === "country" && (
          selectedCountry ? (
            <div className="p-2">
              <CountryPanel
                countryName={selectedCountry}
                mapped={mapped}
                unmapped={unmapped}
                onSelectMarket={handleMarketClick}
              />
            </div>
          ) : (
            <div className="p-2 font-mono">
              <div className="text-[11px] text-[#777] mb-2">
                click a country on the map to view related markets
              </div>
              <TopCountries mapped={mapped} onSelectMarket={handleMarketClick} />
            </div>
          )
        )}

        {activeTab === "live" && (
          <div className="p-2">
            <LivePanel />
          </div>
        )}

        {activeTab === "settings" && (
          <div className="p-2">
            <SettingsPanel
              activeCategories={activeCategories}
              onToggleCategory={onToggleCategory}
              timeRange={timeRange}
              onTimeRangeChange={onTimeRangeChange}
              autoRefresh={autoRefresh}
              onToggleAutoRefresh={onToggleAutoRefresh}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

// --- Detail empty state: show top movers ---
function DetailEmptyState({
  mapped,
  unmapped,
  activeCategories,
  onSelectMarket,
}: {
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
  activeCategories: Set<Category>;
  onSelectMarket: (m: ProcessedMarket) => void;
}) {
  const all = [...mapped, ...unmapped];
  const topMovers = all
    .filter((m) => activeCategories.has(m.category) && m.change !== null && !isNaN(m.change!))
    .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))
    .slice(0, 5);

  return (
    <div className="p-2 font-mono">
      <div className="text-[11px] text-[#777] mb-2">
        select a market to view full details
      </div>
      {topMovers.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-[0.1em] text-[#777] mb-1.5">top movers</div>
          {topMovers.map((m) => (
            <MarketCard key={m.id} market={m} showChange onClick={() => onSelectMarket(m)} />
          ))}
        </>
      )}
    </div>
  );
}

// --- Country empty state: show countries with most markets ---
function TopCountries({
  mapped,
  onSelectMarket,
}: {
  mapped: ProcessedMarket[];
  onSelectMarket: (m: ProcessedMarket) => void;
}) {
  const countryCount = new Map<string, number>();
  for (const m of mapped) {
    if (m.location) {
      countryCount.set(m.location, (countryCount.get(m.location) || 0) + 1);
    }
  }
  const sorted = [...countryCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  if (sorted.length === 0) return null;

  return (
    <>
      <div className="text-[10px] uppercase tracking-[0.1em] text-[#777] mb-1.5">top locations</div>
      <div className="space-y-1">
        {sorted.map(([loc, count]) => {
          const topMarket = mapped.find((m) => m.location === loc);
          return (
            <button
              key={loc}
              onClick={() => topMarket && onSelectMarket(topMarket)}
              className="w-full text-left flex items-center justify-between px-2 py-1.5 border border-[#1e1e1e] hover:bg-[#141414] transition-colors text-[11px] font-mono"
            >
              <span className="text-[#ccc]">{loc.toLowerCase()}</span>
              <span className="text-[#777]">{count} markets</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// --- Markets tab content ---
function MarketsTab({
  mapped,
  unmapped,
  activeCategories,
  onFlyTo,
  onSelectMarket,
  loading,
}: {
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
  activeCategories: Set<Category>;
  onFlyTo: (coords: [number, number], marketId: string) => void;
  onSelectMarket: (m: ProcessedMarket) => void;
  loading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [renderNow] = useState(() => Date.now());

  const all = [...mapped, ...unmapped];
  const filtered = all.filter((m) => activeCategories.has(m.category));

  // Apply search filter
  const searchFiltered = search.trim()
    ? filtered.filter((m) =>
        m.title.toLowerCase().includes(search.toLowerCase()) ||
        (m.location && m.location.toLowerCase().includes(search.toLowerCase())) ||
        m.category.toLowerCase().includes(search.toLowerCase())
      )
    : null;

  const newMarkets = (searchFiltered || filtered)
    .filter(
      (m) =>
        m.createdAt &&
        renderNow - new Date(m.createdAt).getTime() < NEW_THRESHOLD_MS
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
    )
    .slice(0, 10);

  const movers = (searchFiltered || filtered)
    .filter((i) => i.change !== null && !isNaN(i.change!))
    .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))
    .slice(0, 10);

  const trending = [...(searchFiltered || filtered)]
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
    .slice(0, 10);

  const global = searchFiltered
    ? []
    : [...unmapped]
        .filter((m) => activeCategories.has(m.category))
        .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
        .slice(0, 8);

  const cardAction = (m: ProcessedMarket) => {
    if (m.coords) onFlyTo(m.coords, m.id);
    onSelectMarket(m);
  };

  // Show search results as flat list
  if (searchFiltered) {
    return (
      <>
        <SearchBar value={search} onChange={setSearch} />
        <Section title={`RESULTS (${searchFiltered.length})`}>
          {searchFiltered.length === 0 ? (
            <EmptyState text="no markets match" />
          ) : (
            searchFiltered.slice(0, 30).map((m) => (
              <MarketCard key={m.id} market={m} showChange onClick={() => cardAction(m)} />
            ))
          )}
        </Section>
      </>
    );
  }

  return (
    <>
      <SearchBar value={search} onChange={setSearch} />

      {/* Skeleton loading */}
      {loading && mapped.length === 0 && (
        <div className="p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {newMarkets.length > 0 && (
        <Section title="New Markets">
          {newMarkets.map((m) => (
            <MarketCard key={m.id} market={m} showChange onClick={() => cardAction(m)} />
          ))}
        </Section>
      )}

      <Section title="24h Movers">
        {movers.length === 0 ? (
          <EmptyState />
        ) : (
          movers.map((m) => (
            <MarketCard key={m.id} market={m} showChange onClick={() => cardAction(m)} />
          ))
        )}
      </Section>

      <Section title="Trending by Volume">
        {trending.length === 0 ? (
          <EmptyState />
        ) : (
          trending.map((m) => (
            <MarketCard key={m.id} market={m} showChange onClick={() => cardAction(m)} />
          ))
        )}
      </Section>

      {global.length > 0 && (
        <Section title="Global Markets">
          {global.map((m) => (
            <MarketCard key={m.id} market={m} showChange onClick={() => cardAction(m)} />
          ))}
        </Section>
      )}
    </>
  );
}

// --- Search bar ---
function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="px-2 py-1.5 border-b border-[#1e1e1e]">
      <div className="relative">
        <svg
          className="absolute left-2 top-1/2 -translate-y-1/2 text-[#777]"
          width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
        >
          <circle cx="7" cy="7" r="5" />
          <path d="M11 11l3 3" />
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="search markets..."
          className="w-full bg-[#111] border border-[#1e1e1e] text-[11px] text-[#ccc] font-mono py-1 pl-7 pr-2 placeholder:text-[#8a8a8a] focus:outline-none focus:border-[#333] transition-colors"
        />
        {value && (
          <button
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#777] hover:text-[#ccc] text-[11px]"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

// --- Skeleton card ---
function SkeletonCard() {
  return (
    <div className="border border-[#1e1e1e] px-2.5 py-1.5 mb-1 animate-pulse">
      <div className="h-2 w-20 bg-[#1a1a1a] rounded-sm mb-2" />
      <div className="h-2.5 w-full bg-[#1a1a1a] rounded-sm mb-1" />
      <div className="h-2.5 w-3/4 bg-[#1a1a1a] rounded-sm mb-2" />
      <div className="flex justify-between">
        <div className="h-2.5 w-12 bg-[#1a1a1a] rounded-sm" />
        <div className="h-2.5 w-16 bg-[#1a1a1a] rounded-sm" />
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-2 py-1.5 border-b border-[#1e1e1e]">
      <h3 className="text-[10px] font-mono uppercase tracking-[0.1em] text-[#777] mb-1">
        {title}
      </h3>
      {children}
    </div>
  );
}

function EmptyState({ text = "no data" }: { text?: string }) {
  return (
    <div className="text-[12px] text-[#8a8a8a] py-2 font-mono">{text}</div>
  );
}
