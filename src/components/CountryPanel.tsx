"use client";

import { useState, useCallback, useEffect } from "react";
import { ProcessedMarket } from "@/types";
import { getCountryFlag, marketMatchesCountry } from "@/lib/countries";
import { formatVolume } from "@/lib/format";
import MarketCard from "./MarketCard";

interface CountryPanelProps {
  countryName: string;
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
  onSelectMarket: (market: ProcessedMarket) => void;
}

export default function CountryPanel({
  countryName,
  mapped,
  unmapped,
  onSelectMarket,
}: CountryPanelProps) {
  const flag = getCountryFlag(countryName);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Reset summary when country changes
  useEffect(() => {
    setAiSummary(null);
  }, [countryName]);

  const allMarkets = [...mapped, ...unmapped];
  const countryMarkets = allMarkets
    .filter((m) => marketMatchesCountry(m.location, countryName))
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));

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
            country: countryName,
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
  }, [countryName, countryMarkets, aiLoading]);

  return (
    <div className="font-mono">
      {/* Country header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[18px]">{flag}</span>
        <h2 className="text-[13px] text-[var(--text)]">{countryName}</h2>
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
        <div className="border border-[#f59e0b]/20 bg-[#f59e0b]/5 rounded-sm px-3 py-2 mb-3">
          <span className="text-[10px] uppercase tracking-wider text-[#f59e0b]">{"\u2728"} ai summary</span>
          <p className="text-[12px] text-[var(--text-dim)] leading-[1.6] mt-1">{aiSummary}</p>
        </div>
      )}

      {/* Aggregate stats */}
      {countryMarkets.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3 text-[12px]">
          <div>
            <div className="text-[13px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-0.5">total vol</div>
            <div className="text-[var(--text-secondary)]">{formatVolume(totalVol)}</div>
          </div>
          <div>
            <div className="text-[13px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-0.5">active</div>
            <div className="text-[var(--text-secondary)]">{activeCount}</div>
          </div>
          <div>
            <div className="text-[13px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-0.5">closed</div>
            <div className="text-[var(--text-secondary)]">{closedCount}</div>
          </div>
        </div>
      )}

      {/* Market count */}
      <div className="text-[13px] uppercase tracking-[0.15em] text-[var(--text-faint)] mb-2">
        {countryMarkets.length} market{countryMarkets.length !== 1 ? "s" : ""}
      </div>

      {/* Markets list */}
      {countryMarkets.length === 0 ? (
        <div className="text-[12px] text-[var(--text-ghost)] py-4">
          no markets found for this country
        </div>
      ) : (
        <div>
          {countryMarkets.map((m) => (
            <MarketCard
              key={m.id}
              market={m}
              showChange
              onClick={() => onSelectMarket(m)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
