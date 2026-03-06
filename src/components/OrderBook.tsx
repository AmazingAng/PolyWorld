"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { ProcessedMarket, OrderBookData, OrderBookLevel } from "@/types";

// Brighter colors for better contrast on dark backgrounds
const BID_COLOR = "#4ade80";
const ASK_COLOR = "#f87171";
const BID_BAR = "rgba(74, 222, 128, 0.18)";
const ASK_BAR = "rgba(248, 113, 113, 0.18)";

interface OrderBookPanelProps {
  selectedMarket: ProcessedMarket | null;
}

/** Extract Yes token ID from the primary sub-market */
function getYesTokenId(market: ProcessedMarket): string | null {
  const primary = market.markets.find(m => m.active !== false) || market.markets[0];
  if (!primary) return null;
  const raw = primary.clobTokenIds;
  if (!raw) return null;
  try {
    const arr: string[] = Array.isArray(raw) ? raw : JSON.parse(raw);
    return arr[0] || null;
  } catch {
    return null;
  }
}

export default function OrderBookPanel({ selectedMarket }: OrderBookPanelProps) {
  const [data, setData] = useState<OrderBookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);

  const tokenId = useMemo(() => {
    if (!selectedMarket || selectedMarket.closed) return null;
    return getYesTokenId(selectedMarket);
  }, [selectedMarket]);

  const fetchBook = useCallback(async () => {
    if (!tokenId) return;
    try {
      const res = await fetch(`/api/orderbook?tokenId=${encodeURIComponent(tokenId)}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      setData(d);
      setError(null);
    } catch {
      setError("Failed to load orderbook");
    }
  }, [tokenId]);

  useEffect(() => {
    if (!tokenId) { setData(null); setError(null); return; }
    setLoading(true);
    setError(null);
    fetchBook().finally(() => setLoading(false));
  }, [tokenId, fetchBook]);

  useEffect(() => {
    if (!tokenId) return;
    intervalRef.current = setInterval(fetchBook, 10_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [tokenId, fetchBook]);

  // Track whether we need to scroll-center on next data render
  const needsScrollCenter = useRef(true);

  useEffect(() => {
    setData(null);
    needsScrollCenter.current = true;
  }, [selectedMarket?.id]);

  // Scroll to center mid-price after fresh data renders
  useEffect(() => {
    if (!data || !needsScrollCenter.current) return;
    needsScrollCenter.current = false;
    // Double-rAF: first rAF lets React commit DOM, second lets browser layout
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = scrollRef.current;
        const mid = midRef.current;
        if (!container || !mid) return;
        const containerRect = container.getBoundingClientRect();
        const midRect = mid.getBoundingClientRect();
        const midOffsetInScroll = midRect.top - containerRect.top + container.scrollTop;
        container.scrollTop = midOffsetInScroll - containerRect.height / 2 + midRect.height / 2;
      });
    });
  }, [data]);

  if (!selectedMarket || !tokenId) {
    return (
      <div className="text-[11px] text-[var(--text-muted)] font-mono p-2">
        {selectedMarket?.closed
          ? "orderbook not available for closed markets"
          : "select an active market to view orderbook"}
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-4 justify-center">
        <span className="inline-block w-3 h-3 border border-[var(--text-faint)] border-t-transparent rounded-full animate-spin" />
        <span className="text-[10px] text-[var(--text-faint)]">loading...</span>
      </div>
    );
  }

  if (error && !data) {
    return <div className="text-[10px] text-[var(--text-faint)] py-4 text-center">{error}</div>;
  }

  if (!data) return null;

  const bids = data.bids.slice(0, 15);
  const asks = data.asks.slice(0, 15);
  const maxCumSize = Math.max(
    bids.length > 0 ? bids[bids.length - 1].cumSize : 0,
    asks.length > 0 ? asks[asks.length - 1].cumSize : 0,
    1,
  );
  const totalBidDepth = bids.reduce((s, l) => s + l.size, 0);
  const totalAskDepth = asks.reduce((s, l) => s + l.size, 0);
  const spreadPct = data.midPrice > 0 ? (data.spread / data.midPrice) * 100 : 0;

  return (
    <div className="flex flex-col h-full -m-2">
      {/* Stats bar — compact top strip */}
      <div className="flex items-center justify-between px-2 py-1 text-[9px] tabular-nums border-b border-[var(--border-subtle)] shrink-0" style={{ background: "rgba(255,255,255,0.02)" }}>
        <span className="text-[var(--text-faint)]">
          spread <span className="text-[var(--text-secondary)]">{data.spread.toFixed(3)}</span>
          <span className="ml-0.5">({spreadPct.toFixed(1)}%)</span>
        </span>
        <span style={{ color: BID_COLOR }}>{fmtK(totalBidDepth)}</span>
        <span className="text-[var(--text-faint)]">depth</span>
        <span style={{ color: ASK_COLOR }}>{fmtK(totalAskDepth)}</span>
      </div>

      {/* Column headers */}
      <div className="flex items-center text-[8px] uppercase tracking-widest text-[var(--text-ghost)] px-2 py-0.5 shrink-0">
        <span className="w-[52px]">price</span>
        <span className="w-[52px] text-right">size</span>
        <span className="flex-1 text-right">total</span>
      </div>

      {/* Scrollable orderbook — centered on mid-price */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto ob-scroll relative">
        {/* Asks (reversed: highest at top, lowest near spread) */}
        {[...asks].reverse().map((level, i) => (
          <OBRow key={`a-${i}`} level={level} side="ask" maxCum={maxCumSize} />
        ))}

        {/* Mid-price divider */}
        <div ref={midRef} className="flex items-center gap-1.5 px-2 py-1 my-px" style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="flex-1 h-px bg-[var(--border)]" />
          <span className="text-[11px] font-bold tabular-nums text-[var(--text)]">
            {data.lastTradePrice > 0 ? data.lastTradePrice.toFixed(3) : data.midPrice.toFixed(3)}
          </span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>

        {/* Bids */}
        {bids.map((level, i) => (
          <OBRow key={`b-${i}`} level={level} side="bid" maxCum={maxCumSize} />
        ))}
      </div>
    </div>
  );
}

function OBRow({ level, side, maxCum }: { level: OrderBookLevel; side: "bid" | "ask"; maxCum: number }) {
  const pct = maxCum > 0 ? (level.cumSize / maxCum) * 100 : 0;
  const bid = side === "bid";
  return (
    <div className="ob-row flex items-center text-[10px] tabular-nums px-2 relative" style={{ height: 18 }}>
      <div className="absolute inset-y-0 right-0" style={{ width: `${pct}%`, background: bid ? BID_BAR : ASK_BAR }} />
      <span className="w-[52px] font-medium relative z-[1]" style={{ color: bid ? BID_COLOR : ASK_COLOR }}>
        {level.price.toFixed(3)}
      </span>
      <span className="w-[52px] text-right text-[var(--text-secondary)] relative z-[1]">
        {fmtK(level.size)}
      </span>
      <span className="flex-1 text-right text-[var(--text-dim)] text-[9px] relative z-[1]">
        {fmtK(level.cumSize)}
      </span>
    </div>
  );
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toString();
}
