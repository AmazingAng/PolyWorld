"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProcessedMarket, SmartWallet, WhaleTrade, NewsItem } from "@/types";
import { generateSignals, getSignalIcon, type UnifiedSignal, type UnifiedSignalType } from "@/lib/signalEngine";

interface SignalPanelProps {
  trades: WhaleTrade[];
  markets: ProcessedMarket[];
  leaderboard: SmartWallet[];
  onSelectMarket?: (slug: string) => void;
  onSelectWallet?: (address: string) => void;
  categoryFilter: Set<string>;
  strengthFilter: Set<string>;
}

const STRENGTH_COLORS: Record<string, string> = {
  strong: "#ff4444",
  moderate: "#f59e0b",
  weak: "var(--text-dim)",
};
const STRENGTH_BG: Record<string, string> = {
  strong: "rgba(255,68,68,0.12)",
  moderate: "rgba(245,158,11,0.10)",
  weak: "rgba(128,128,128,0.08)",
};
const TYPE_LABELS: Record<UnifiedSignalType, string> = {
  top_wallet_entry: "Wallet",
  top_cluster: "Cluster",
  news_catalyst: "News+$",
  whale_accumulation: "Whale",
  smart_divergence: "Diverg.",
  cluster_activity: "Cluster",
  momentum_shift: "Moment.",
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "<1m";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86400_000)}d`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

/** Hook for page.tsx to get signal data + available categories for the dropdown */
export function useSignalData(trades: WhaleTrade[], markets: ProcessedMarket[], leaderboard: SmartWallet[]) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const newsRetry = useRef(0);

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch("/api/news");
      if (!res.ok) return;
      setNews(await res.json());
      newsRetry.current = 0;
    } catch {
      if (newsRetry.current < 2) {
        newsRetry.current++;
        setTimeout(fetchNews, 3000);
      }
    }
  }, []);

  useEffect(() => {
    fetchNews();
    const iv = setInterval(fetchNews, 120_000);
    return () => clearInterval(iv);
  }, [fetchNews]);

  const signals = useMemo(
    () => generateSignals(trades, markets, leaderboard, news),
    [trades, markets, leaderboard, news]
  );

  // Build slug → category lookup
  const slugToCategory = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of markets) map.set(m.slug, m.category);
    return map;
  }, [markets]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const s of signals) {
      const cat = slugToCategory.get(s.market.slug);
      if (cat) cats.add(cat);
    }
    return Array.from(cats).sort();
  }, [signals, slugToCategory]);

  return { signals, categories, slugToCategory };
}

export default function SignalPanel({
  trades,
  markets,
  leaderboard,
  onSelectMarket,
  onSelectWallet,
  categoryFilter,
  strengthFilter,
}: SignalPanelProps) {
  const { signals, slugToCategory } = useSignalData(trades, markets, leaderboard);
  const filtered = useMemo(() => {
    let result = signals;
    if (strengthFilter.size > 0) result = result.filter((s) => strengthFilter.has(s.strength));
    if (categoryFilter.size > 0) result = result.filter((s) => {
      const cat = slugToCategory.get(s.market.slug);
      return cat && categoryFilter.has(cat);
    });
    return result;
  }, [signals, categoryFilter, strengthFilter, slugToCategory]);

  return (
    <div className="font-mono">
      {filtered.length === 0 ? (
        <div className="text-[12px] text-[var(--text-ghost)] py-4 text-center">
          No signals detected
        </div>
      ) : (
        <div className="space-y-0">
          {filtered.map((sig) => (
            <SignalCard
              key={sig.id}
              signal={sig}
              onSelectMarket={onSelectMarket}
              onSelectWallet={onSelectWallet}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SignalCard({
  signal,
  onSelectMarket,
  onSelectWallet,
}: {
  signal: UnifiedSignal;
  onSelectMarket?: (slug: string) => void;
  onSelectWallet?: (address: string) => void;
}) {
  const icon = getSignalIcon(signal.type);
  const sColor = STRENGTH_COLORS[signal.strength];
  const sBg = STRENGTH_BG[signal.strength];
  const dirColor = signal.direction === "bullish" ? "var(--green, #22c55e)" : "var(--red, #ef4444)";
  const dirArrow = signal.direction === "bullish" ? "\u25B2" : "\u25BC";

  return (
    <div
      className="border-b border-[var(--border-subtle)] last:border-0"
      style={{ background: signal.strength === "strong" ? "rgba(255,68,68,0.03)" : undefined }}
    >
      <div
        className="flex items-start gap-1.5 px-1.5 py-[5px] cursor-pointer hover:bg-[var(--surface-hover)] transition-colors"
        onClick={() => onSelectMarket?.(signal.market.slug)}
      >
        <div className="flex flex-col items-center shrink-0 w-7 pt-0.5">
          <span className="text-[13px] leading-none">{icon}</span>
          <span
            className="text-[8px] font-bold rounded-sm px-0.5 mt-0.5 leading-[14px]"
            style={{ background: sBg, color: sColor }}
          >
            {signal.strength.slice(0, 3).toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
              {TYPE_LABELS[signal.type]}
            </span>
            <span className="text-[9px] font-bold" style={{ color: dirColor }}>
              {dirArrow} {signal.direction}
            </span>
            <span className="text-[9px] text-[var(--text-ghost)] ml-auto shrink-0">
              {timeAgo(signal.timestamp)}
            </span>
          </div>

          <div className="text-[11px] text-[var(--text-secondary)] leading-tight">
            {signal.summary}
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            {signal.details.totalVolume && (
              <span className="text-[9px] text-[var(--text-dim)] tabular-nums">
                ${(signal.details.totalVolume / 1000).toFixed(1)}k vol
              </span>
            )}
            {signal.details.tradeCount && (
              <span className="text-[9px] text-[var(--text-dim)] tabular-nums">
                {signal.details.tradeCount} trades
              </span>
            )}
            {signal.wallets.length > 0 && (
              <span className="text-[9px] text-[var(--text-dim)]">
                {signal.wallets.length} wallet{signal.wallets.length > 1 ? "s" : ""}
              </span>
            )}
            {signal.market.prob !== null && (
              <span className="text-[9px] tabular-nums text-[var(--text-dim)]">
                @{(signal.market.prob * 100).toFixed(0)}%
              </span>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
