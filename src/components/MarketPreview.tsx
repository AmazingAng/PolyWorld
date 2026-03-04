"use client";

import { useMemo } from "react";
import { ProcessedMarket, PolymarketMarket } from "@/types";
import { CATEGORY_COLORS } from "@/lib/categories";
import { formatVolume, formatPct, formatChange } from "@/lib/format";
import Sparkline from "./Sparkline";

/** Check if all sub-markets are binary Yes/No */
function isMultiBinary(markets: PolymarketMarket[]): boolean {
  if (markets.length < 2) return false;
  return markets.every(m => {
    let labels: string[] = [];
    if (Array.isArray(m.outcomes)) labels = m.outcomes;
    else if (typeof m.outcomes === "string") {
      try { labels = JSON.parse(m.outcomes); } catch { return false; }
    }
    return labels.length === 2 && labels[0] === "Yes" && labels[1] === "No";
  });
}

interface ParsedOption {
  label: string;
  prob: number;
}

export default function MarketPreview({ market }: { market: ProcessedMarket }) {
  const color = CATEGORY_COLORS[market.category] || CATEGORY_COLORS.Other;
  const chg = formatChange(market.change);
  const activeMarkets = useMemo(
    () => (market.markets || []).filter(m => m.active !== false),
    [market.markets]
  );
  const multiBinary = useMemo(() => isMultiBinary(activeMarkets), [activeMarkets]);

  // Parse top outcomes
  const topOutcomes = useMemo((): ParsedOption[] => {
    if (!multiBinary) return [];
    return activeMarkets.map(m => {
      let yesPrice = 0;
      try {
        const raw = m.outcomePrices
          ? Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices)
          : null;
        if (raw) yesPrice = parseFloat(raw[0]);
      } catch { /* skip */ }
      return {
        label: m.groupItemTitle || m.question || "?",
        prob: isNaN(yesPrice) ? 0 : yesPrice,
      };
    })
      .sort((a, b) => b.prob - a.prob)
      .slice(0, 6);
  }, [activeMarkets, multiBinary]);

  return (
    <div className="font-mono">
      {/* Header */}
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
        {market.category.toLowerCase()}
        {market.location && <span className="text-[var(--text-faint)]">{"\u00B7"} {market.location.toLowerCase()}</span>}
      </div>
      <div className="text-[13px] text-[var(--text)] leading-[1.4] mb-3">{market.title}</div>

      {/* Stats row */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-[20px] text-[var(--text)] font-bold">
          {market.prob !== null ? formatPct(market.prob) : "\u2014"}
        </span>
        <span className={`text-[12px] ${chg.cls === "up" ? "text-[#22c55e]" : chg.cls === "down" ? "text-[#ff4444]" : "text-[var(--text-faint)]"}`}>
          {chg.text}
        </span>
        <span className="text-[11px] text-[var(--text-muted)]">
          Vol {formatVolume(market.volume24h || market.volume)}
        </span>
      </div>

      {/* Chart */}
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-sm p-1.5 mb-3" style={{ boxShadow: "inset 0 1px 3px rgba(0,0,0,0.2)" }}>
        <Sparkline
          eventId={market.id}
          hours={24}
          width={440}
          height={140}
          multiSeries={activeMarkets.length > 1}
        />
      </div>

      {/* Outcomes (multi-binary only, compact) */}
      {multiBinary && topOutcomes.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-1">
            outcomes ({activeMarkets.length})
          </div>
          {topOutcomes.map((o, i) => {
            const pct = o.prob * 100;
            return (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="w-16 shrink-0 truncate text-[var(--text-secondary)]" title={o.label}>
                  {o.label}
                </span>
                <div className="flex-1 h-3 bg-[var(--bg)] rounded-sm overflow-hidden border border-[var(--border-subtle)]">
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${Math.max(pct, 1)}%`,
                      background: `linear-gradient(90deg, ${color}aa, ${color}55)`,
                    }}
                  />
                </div>
                <span className="w-10 text-right tabular-nums text-[var(--text-dim)]">
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          })}
          {activeMarkets.length > 6 && (
            <div className="text-[10px] text-[var(--text-faint)] mt-1">
              +{activeMarkets.length - 6} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
