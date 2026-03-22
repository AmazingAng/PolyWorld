"use client";

import { useMemo } from "react";
import { ProcessedMarket, PolymarketMarket } from "@/types";
import { CATEGORY_COLORS } from "@/lib/categories";
import { formatVolume, formatPct, formatChange } from "@/lib/format";
import Sparkline from "./Sparkline";
import type { TradeModalState } from "./TradeModal";

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

function parseTokenIds(m: PolymarketMarket): string[] {
  if (!m.clobTokenIds) return [];
  if (Array.isArray(m.clobTokenIds)) return m.clobTokenIds as string[];
  try { return JSON.parse(m.clobTokenIds as string) as string[]; } catch { return []; }
}

function parsePrices(m: PolymarketMarket): number[] {
  if (!m.outcomePrices) return [];
  const raw = Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices as string);
  return raw.map((p: string) => parseFloat(p));
}

interface ParsedOption {
  label: string;
  prob: number;
  m: PolymarketMarket;
  yesTokenId: string;
  noTokenId: string;
}

interface MarketPreviewProps {
  market: ProcessedMarket;
  onTrade?: (state: TradeModalState) => void;
  /** Force single-line chart (don't show other options) */
  singleSeries?: boolean;
}

export default function MarketPreview({ market, onTrade, singleSeries }: MarketPreviewProps) {
  const color = CATEGORY_COLORS[market.category] || CATEGORY_COLORS.Other;
  const chg = formatChange(market.change);
  const activeMarkets = useMemo(
    () => (market.markets || []).filter(m => m.active !== false),
    [market.markets]
  );
  const multiBinary = useMemo(() => isMultiBinary(activeMarkets), [activeMarkets]);

  // Parse top outcomes for multi-binary
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
      const ids = parseTokenIds(m);
      return {
        label: m.groupItemTitle || m.question || "?",
        prob: isNaN(yesPrice) ? 0 : yesPrice,
        m,
        yesTokenId: ids[0] ? String(ids[0]) : "",
        noTokenId: ids[1] ? String(ids[1]) : "",
      };
    })
      .sort((a, b) => b.prob - a.prob)
      .slice(0, 6);
  }, [activeMarkets, multiBinary]);

  // Simple market (single sub-market with Yes/No)
  const simpleTrade = useMemo(() => {
    if (multiBinary || market.closed) return null;
    const m = activeMarkets[0];
    if (!m) return null;
    const ids = parseTokenIds(m);
    const prices = parsePrices(m);
    if (ids.length < 2) return null;
    return {
      yesTokenId: String(ids[0]),
      noTokenId: String(ids[1]),
      yesPrice: prices[0] ?? (market.prob ?? 0.5),
      noPrice: prices[1] ?? (1 - (prices[0] ?? 0.5)),
    };
  }, [activeMarkets, multiBinary, market.closed, market.prob]);

  const openTrade = (tokenId: string, price: number, outcomeName: string, title: string, side: "BUY" | "SELL", yesToken?: { tokenId: string; price: number; name: string }, noToken?: { tokenId: string; price: number; name: string }) => {
    if (!onTrade || !tokenId) return;
    onTrade({
      tokenId,
      currentPrice: price,
      outcomeName,
      marketTitle: title,
      negRisk: !!market.negRisk,
      defaultSide: side,
      yesToken,
      noToken,
      smartMoney: market.smartMoney,
      volume: market.volume,
      volume24h: market.volume24h,
      liquidity: market.liquidity,
      recentChange: market.recentChange,
    });
  };

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
          multiSeries={!singleSeries && activeMarkets.length > 1}
        />
      </div>

      {/* Simple Yes/No trade button */}
      {!multiBinary && simpleTrade && onTrade && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={(e) => { e.stopPropagation(); openTrade(
              simpleTrade.yesTokenId, simpleTrade.yesPrice, "Yes", market.title, "BUY",
              { tokenId: simpleTrade.yesTokenId, price: simpleTrade.yesPrice, name: "Yes" },
              { tokenId: simpleTrade.noTokenId, price: simpleTrade.noPrice, name: "No" },
            ); }}
            className="flex-1 py-1.5 text-[11px] font-bold transition-colors hover:opacity-80"
            style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
          >
            Buy {(simpleTrade.yesPrice * 100).toFixed(0)}%
          </button>
        </div>
      )}

      {/* Outcomes (multi-binary) */}
      {multiBinary && topOutcomes.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-1">
            outcomes ({activeMarkets.length})
          </div>
          {topOutcomes.map((o, i) => {
            const pct = o.prob * 100;
            return (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                <span className="flex-1 truncate text-[var(--text-secondary)]" title={o.label}>
                  {o.label}
                </span>
                {onTrade && !market.closed && o.yesTokenId ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); openTrade(
                      o.yesTokenId, o.prob, o.label, market.title, "BUY",
                      o.yesTokenId ? { tokenId: o.yesTokenId, price: o.prob, name: o.label } : undefined,
                      o.noTokenId ? { tokenId: o.noTokenId, price: 1 - o.prob, name: `${o.label} No` } : undefined,
                    ); }}
                    className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 transition-colors hover:opacity-80"
                    style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
                    title={`Buy ${o.label}`}
                  >
                    Buy {pct.toFixed(0)}%
                  </button>
                ) : (
                  <span className="w-10 text-right tabular-nums text-[var(--text-dim)]">
                    {pct.toFixed(1)}%
                  </span>
                )}
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
