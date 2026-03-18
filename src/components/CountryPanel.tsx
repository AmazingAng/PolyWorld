"use client";

import { useState, useCallback, useMemo } from "react";
import { ProcessedMarket } from "@/types";
import { getCountryFlag, marketMatchesCountry } from "@/lib/countries";
import { getParentCountry } from "@/lib/geo";
import { formatVolume } from "@/lib/format";
import MarketCard from "./MarketCard";

interface CountryPanelProps {
  countryName: string;
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
  onSelectMarket: (market: ProcessedMarket) => void;
  isWatched?: (id: string) => boolean;
  onToggleWatch?: (id: string) => void;
}

export default function CountryPanel({
  countryName,
  mapped,
  unmapped,
  onSelectMarket,
  isWatched,
  onToggleWatch,
}: CountryPanelProps) {
  const parentCountry = getParentCountry(countryName);
  const displayName = parentCountry ? `${countryName}, ${parentCountry}` : countryName;
  const flagSource = parentCountry || countryName;
  const flag = getCountryFlag(flagSource);

  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [prevCountry, setPrevCountry] = useState(countryName);

  // Reset summary when region changes (derived state from props)
  if (prevCountry !== countryName) {
    setPrevCountry(countryName);
    setAiSummary(null);
  }

  const allMarkets = useMemo(() => [...mapped, ...unmapped], [mapped, unmapped]);

  const countryMarkets = useMemo(() => {
    const seen = new Set<string>();
    const results: ProcessedMarket[] = [];
    // Match against the selected location
    for (const m of allMarkets) {
      if (marketMatchesCountry(m.location, countryName)) {
        if (!seen.has(m.id)) { seen.add(m.id); results.push(m); }
      }
    }
    // Also match against parent country if it's a city/sub-region
    if (parentCountry) {
      for (const m of allMarkets) {
        if (!seen.has(m.id) && marketMatchesCountry(m.location, parentCountry)) {
          seen.add(m.id);
          results.push(m);
        }
      }
    }
    return results.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
  }, [allMarkets, countryName, parentCountry]);

  const totalVol = countryMarkets.reduce((s, m) => s + m.volume, 0);
  const activeCount = countryMarkets.filter((m) => m.active && !m.closed).length;
  const closedCount = countryMarkets.filter((m) => m.closed).length;

  const fetchCountrySummary = useCallback(async () => {
    if (aiLoading || countryMarkets.length === 0) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "country",
          cacheKey: `country:${countryName}`,
          context: {
            country: displayName,
            markets: countryMarkets.slice(0, 8).map((m) => ({
              title: m.title,
              prob: m.prob,
              change: m.change,
              volume24h: m.volume24h,
            })),
          },
        }),
      });
      const data = await res.json();
      if (data.summary) setAiSummary(data.summary);
    } catch {
      setAiSummary("Failed to generate summary");
    }
    setAiLoading(false);
  }, [countryName, displayName, countryMarkets, aiLoading]);

  return (
    <div className="font-mono">
      {/* Region header */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[14px]">{flag}</span>
        <h2 className="text-[12px] text-[var(--text)]">{displayName}</h2>
        <button
          onClick={fetchCountrySummary}
          disabled={aiLoading || countryMarkets.length === 0}
          className="shrink-0 text-[var(--text-faint)] hover:text-[#f59e0b] transition-colors disabled:opacity-50 ml-auto"
          title="AI Summary"
        >
          {aiLoading ? (
            <span className="inline-block w-3 h-3 border border-[#f59e0b] border-t-transparent rounded-full animate-spin" />
          ) : (
            <span className="text-[14px]">{"\u2728"}</span>
          )}
        </button>
      </div>

      {/* AI Summary */}
      {aiSummary && (
        <div className="border border-[#f59e0b]/20 bg-[#f59e0b]/5 rounded-sm px-2.5 py-1.5 mb-2">
          <span className="text-[9px] uppercase tracking-wider text-[#f59e0b]">{"\u2728"} ai summary</span>
          <p className="text-[11px] text-[var(--text-dim)] leading-[1.5] mt-0.5">{aiSummary}</p>
        </div>
      )}

      {/* Aggregate stats */}
      {countryMarkets.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 mb-2 text-[11px]">
          <div className="border border-[var(--border-subtle)] rounded-sm px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-0.5">total vol</div>
            <div className="text-[var(--text-secondary)]">{formatVolume(totalVol)}</div>
          </div>
          <div className="border border-[var(--border-subtle)] rounded-sm px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-0.5">active</div>
            <div className="text-[var(--text-secondary)]">{activeCount}</div>
          </div>
          <div className="border border-[var(--border-subtle)] rounded-sm px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-0.5">closed</div>
            <div className="text-[var(--text-secondary)]">{closedCount}</div>
          </div>
        </div>
      )}

      {/* Market count */}
      <div className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-faint)] mb-1.5">
        {countryMarkets.length} market{countryMarkets.length !== 1 ? "s" : ""}
      </div>

      {/* Markets list */}
      {countryMarkets.length === 0 ? (
        <div className="text-[12px] text-[var(--text-ghost)] py-4">
          no markets found for this region
        </div>
      ) : (
        <div>
          {countryMarkets.map((m) => (
            <MarketCard
              key={m.id}
              market={m}
              showChange
              onClick={() => onSelectMarket(m)}
              isWatched={isWatched?.(m.id)}
              onToggleWatch={onToggleWatch ? () => onToggleWatch(m.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
