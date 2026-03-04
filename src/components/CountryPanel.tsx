"use client";

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

  const allMarkets = [...mapped, ...unmapped];
  const countryMarkets = allMarkets
    .filter((m) => marketMatchesCountry(m.location, countryName))
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));

  const totalVol = countryMarkets.reduce((s, m) => s + m.volume, 0);
  const activeCount = countryMarkets.filter((m) => m.active && !m.closed).length;
  const closedCount = countryMarkets.filter((m) => m.closed).length;

  return (
    <div className="font-mono">
      {/* Country header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[18px]">{flag}</span>
        <h2 className="text-[13px] text-[var(--text)]">{countryName}</h2>
      </div>

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
