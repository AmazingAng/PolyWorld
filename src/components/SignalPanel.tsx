"use client";

import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProcessedMarket, SmartWallet, WhaleTrade, NewsItem } from "@/types";
import { generateSignals, getSignalIcon, type UnifiedSignal, type UnifiedSignalType } from "@/lib/signalEngine";
import type { TradeModalState } from "./TradeModal";

const MarketPreview = lazy(() => import("./MarketPreview"));

interface SignalPanelProps {
  trades: WhaleTrade[];
  markets: ProcessedMarket[];
  leaderboard: SmartWallet[];
  onSelectMarket?: (slug: string) => void;
  onSelectWallet?: (address: string) => void;
  onOpenTrade?: (slug: string, direction: "bullish" | "bearish") => void;
  categoryFilter: Set<string>;
  strengthFilter: Set<string>;
  onTrade?: (state: TradeModalState) => void;
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

/** Hook for page.tsx to get signal data + available categories for the dropdown */
export function useSignalData(trades: WhaleTrade[], markets: ProcessedMarket[], leaderboard: SmartWallet[]) {
  const deferredTrades = useDeferredValue(trades);
  const deferredMarkets = useDeferredValue(markets);
  const [news, setNews] = useState<NewsItem[]>([]);
  const newsRetry = useRef(0);
  const fetchNewsRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch("/api/news");
      if (!res.ok) return;
      setNews(await res.json());
      newsRetry.current = 0;
    } catch {
      if (newsRetry.current < 2) {
        newsRetry.current++;
        setTimeout(() => fetchNewsRef.current?.(), 3000);
      }
    }
  }, []);

  useEffect(() => {
    fetchNewsRef.current = fetchNews;
    queueMicrotask(() => {
      void fetchNews();
    });
    const iv = setInterval(fetchNews, 120_000);
    return () => clearInterval(iv);
  }, [fetchNews]);

  const signals = useMemo(
    () => generateSignals(deferredTrades, deferredMarkets, leaderboard, news),
    [deferredTrades, deferredMarkets, leaderboard, news]
  );

  // Build slug → category lookup
  const slugToCategory = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of deferredMarkets) map.set(m.slug, m.category);
    return map;
  }, [deferredMarkets]);

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
  onOpenTrade,
  categoryFilter,
  strengthFilter,
  onTrade,
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
              markets={markets}
              onSelectMarket={onSelectMarket}
              onSelectWallet={onSelectWallet}
              onOpenTrade={onOpenTrade}
              onTrade={onTrade}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const POPUP_W = 480;
const POPUP_MAX_H = 420;
const POPUP_GAP = 8;

function SignalCard({
  signal,
  markets,
  onSelectMarket,
  onSelectWallet: _onSelectWallet,
  onOpenTrade,
  onTrade,
}: {
  signal: UnifiedSignal;
  markets: ProcessedMarket[];
  onSelectMarket?: (slug: string) => void;
  onSelectWallet?: (address: string) => void;
  onOpenTrade?: (slug: string, direction: "bullish" | "bearish") => void;
  onTrade?: (state: TradeModalState) => void;
}) {
  const icon = getSignalIcon(signal.type);
  const sColor = STRENGTH_COLORS[signal.strength];
  const sBg = STRENGTH_BG[signal.strength];
  const dirColor = signal.direction === "bullish" ? "var(--green, #22c55e)" : "var(--red, #ef4444)";
  const dirArrow = signal.direction === "bullish" ? "\u25B2" : "\u25BC";

  // Hover popup
  const [showPopup, setShowPopup] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolvedMarket = useMemo(
    () => markets.find(m => m.slug === signal.market.slug) ?? null,
    [markets, signal.market.slug]
  );

  const handleMouseEnter = useCallback(() => {
    if (!resolvedMarket) return;
    if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
    hoverTimer.current = setTimeout(() => {
      const el = cardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.left >= POPUP_W + POPUP_GAP ? rect.left - POPUP_W - POPUP_GAP : rect.right + POPUP_GAP;
      left = Math.max(4, Math.min(left, vw - POPUP_W - 4));
      const top = Math.max(4, Math.min(rect.top, vh - POPUP_MAX_H - 4));
      setPopupPos({ top, left });
      setShowPopup(true);
    }, 800);
  }, [resolvedMarket]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    dismissTimer.current = setTimeout(() => setShowPopup(false), 300);
  }, []);

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, []);

  return (
    <div
      ref={cardRef}
      className="border-b border-[var(--border-subtle)] last:border-0"
      style={{ background: signal.strength === "strong" ? "rgba(255,68,68,0.03)" : undefined }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="flex items-start gap-1.5 px-1.5 py-[5px] cursor-pointer hover:bg-[var(--surface-hover)] transition-colors"
        onClick={() => { setShowPopup(false); onSelectMarket?.(signal.market.slug); }}
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
          {(signal.subMarketTitle || (signal.outcomeName && signal.outcomeName !== "Yes" && signal.outcomeName !== "No")) && (
            <div
              className="text-[9px] font-bold mt-0.5 px-1 py-[1px] inline-block rounded-sm w-fit"
              style={{
                background: signal.direction === "bullish" ? "rgba(34,197,94,0.1)" : "rgba(255,68,68,0.1)",
                color: signal.direction === "bullish" ? "#22c55e" : "#ff4444",
              }}
            >
              {signal.direction === "bullish" ? "▲" : "▼"}
              {signal.subMarketTitle ? ` ${signal.subMarketTitle}` : ""}
              {signal.outcomeName && signal.outcomeName !== "Yes" && signal.outcomeName !== "No"
                ? `${signal.subMarketTitle ? " · " : " "}${signal.outcomeName}`
                : ""}
            </div>
          )}

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
            {onOpenTrade && (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenTrade(signal.market.slug, signal.direction); }}
                className="ml-auto text-[8px] font-bold px-1.5 py-0.5 transition-colors hover:opacity-80"
                style={{
                  background: signal.direction === "bullish" ? "rgba(34,197,94,0.15)" : "rgba(255,68,68,0.15)",
                  color: signal.direction === "bullish" ? "#22c55e" : "#ff4444",
                }}
              >
                {signal.direction === "bullish" ? "Buy" : "Sell"} {signal.outcomeName || (signal.direction === "bullish" ? "YES" : "NO")}
              </button>
            )}
          </div>
        </div>
      </div>

      {showPopup && popupPos && resolvedMarket && createPortal(
        <div
          className="fixed z-[9999] bg-[var(--bg)] border border-[var(--border)] rounded-md overflow-y-auto"
          style={{
            top: popupPos.top,
            left: popupPos.left,
            width: POPUP_W,
            maxHeight: POPUP_MAX_H,
            padding: "12px 14px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
          }}
          onMouseEnter={() => {
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
            if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
          }}
          onMouseLeave={handleMouseLeave}
        >
          <Suspense fallback={<div className="text-[12px] text-[var(--text-faint)] font-mono py-4">loading...</div>}>
            <MarketPreview market={resolvedMarket} onTrade={onTrade} singleSeries />
          </Suspense>
        </div>,
        document.body
      )}
    </div>
  );
}
