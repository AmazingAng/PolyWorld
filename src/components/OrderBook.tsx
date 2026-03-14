"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { ProcessedMarket, OrderBookData, OrderBookLevel } from "@/types";
import MarketDepthChart from "./MarketDepthChart";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";

// Brighter colors for better contrast on dark backgrounds
const BID_COLOR = "#4ade80";
const ASK_COLOR = "#f87171";
const BID_BAR = "rgba(74, 222, 128, 0.18)";
const ASK_BAR = "rgba(248, 113, 113, 0.18)";

type BookSide = "YES" | "NO" | "merged";

interface OrderBookPanelProps {
  selectedMarket: ProcessedMarket | null;
}

/** Extract all Yes token IDs from active sub-markets (first token = Yes) */
function getAllYesTokenIds(market: ProcessedMarket): string[] {
  const ids: string[] = [];
  for (const m of market.markets) {
    if (m.active === false) continue;
    const raw = m.clobTokenIds;
    if (!raw) continue;
    try {
      const arr: string[] = Array.isArray(raw) ? raw : JSON.parse(raw);
      if (arr[0]) ids.push(arr[0]);
    } catch { /* skip */ }
  }
  return ids;
}

/** Extract all No token IDs from active sub-markets (second token = No) */
function getAllNoTokenIds(market: ProcessedMarket): string[] {
  const ids: string[] = [];
  for (const m of market.markets) {
    if (m.active === false) continue;
    const raw = m.clobTokenIds;
    if (!raw) continue;
    try {
      const arr: string[] = Array.isArray(raw) ? raw : JSON.parse(raw);
      if (arr[1]) ids.push(arr[1]);
    } catch { /* skip */ }
  }
  return ids;
}

export default function OrderBookPanel({ selectedMarket }: OrderBookPanelProps) {
  const [yesData, setYesData] = useState<OrderBookData | null>(null);
  const [noData, setNoData] = useState<OrderBookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookSide, setBookSide] = useState<BookSide>("YES");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCount = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);

  const yesTokenIds = useMemo(() => {
    if (!selectedMarket || selectedMarket.closed) return [];
    return getAllYesTokenIds(selectedMarket);
  }, [selectedMarket]);

  const noTokenIds = useMemo(() => {
    if (!selectedMarket || selectedMarket.closed) return [];
    return getAllNoTokenIds(selectedMarket);
  }, [selectedMarket]);

  // Track which token ID is currently working per side
  const activeYesTokenRef = useRef<string | null>(null);
  const activeNoTokenRef = useRef<string | null>(null);

  const fetchSide = useCallback(async (
    tokenIds: string[],
    activeRef: React.MutableRefObject<string | null>,
  ): Promise<OrderBookData | null> => {
    if (tokenIds.length === 0) return null;

    const tryOrder = activeRef.current
      ? [activeRef.current, ...tokenIds.filter(t => t !== activeRef.current)]
      : tokenIds;

    for (const tid of tryOrder) {
      try {
        const res = await fetch(`/api/orderbook?tokenId=${encodeURIComponent(tid)}`);
        if (!res.ok) continue;
        const d = await res.json();
        if (d.error) continue;
        if (d.bids?.length > 0 || d.asks?.length > 0) {
          activeRef.current = tid;
          return d;
        }
      } catch { /* try next */ }
    }
    return null;
  }, []);

  const fetchBook = useCallback(async () => {
    if (yesTokenIds.length === 0) return;

    const [yes, no] = await Promise.all([
      fetchSide(yesTokenIds, activeYesTokenRef),
      noTokenIds.length > 0 ? fetchSide(noTokenIds, activeNoTokenRef) : Promise.resolve(null),
    ]);

    if (yes) {
      setYesData(yes);
      setError(null);
      retryCount.current = 0;
    }
    if (no) {
      setNoData(no);
    }

    if (!yes) {
      if (retryCount.current < 3) {
        const delay = 2000 * Math.pow(2, retryCount.current);
        retryCount.current++;
        setTimeout(fetchBook, delay);
      } else {
        setError("load failed");
      }
    }
  }, [yesTokenIds, noTokenIds, fetchSide]);

  useEffect(() => {
    if (yesTokenIds.length === 0) { setYesData(null); setNoData(null); setError(null); activeYesTokenRef.current = null; activeNoTokenRef.current = null; return; }
    setLoading(true);
    setError(null);
    fetchBook().finally(() => setLoading(false));
  }, [yesTokenIds, noTokenIds, fetchBook]);

  useVisibilityPolling(fetchBook, 15_000, yesTokenIds.length > 0);

  // Track whether we need to scroll-center on next data render
  const needsScrollCenter = useRef(true);

  useEffect(() => {
    setYesData(null);
    setNoData(null);
    setBookSide("YES");
    needsScrollCenter.current = true;
  }, [selectedMarket?.id]);

  // Scroll to center mid-price after fresh data renders
  const data = bookSide === "NO" ? noData : yesData;
  useEffect(() => {
    if (!data || !needsScrollCenter.current) return;
    needsScrollCenter.current = false;
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

  if (!selectedMarket || yesTokenIds.length === 0) {
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
    return (
      <div className="text-[11px] text-[var(--red)] font-mono py-2 text-center" aria-live="polite">
        {error} <button onClick={() => { retryCount.current = 0; setLoading(true); setError(null); fetchBook().finally(() => setLoading(false)); }} className="ml-2 underline">retry</button>
      </div>
    );
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

  const hasNo = noTokenIds.length > 0;

  return (
    <div className="flex flex-col h-full -m-2">
      {/* YES/NO toggle */}
      {hasNo && (
        <div className="flex items-center gap-0.5 px-2 py-1 shrink-0 border-b border-[var(--border-subtle)]">
          {(["YES", "NO"] as BookSide[]).map((side) => (
            <button
              key={side}
              onClick={() => { setBookSide(side); needsScrollCenter.current = true; }}
              className="px-2 py-0 text-[9px] rounded transition-colors leading-[18px]"
              style={{
                background: bookSide === side ? (side === "YES" ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)") : "transparent",
                color: bookSide === side ? (side === "YES" ? BID_COLOR : ASK_COLOR) : "var(--text-faint)",
                border: `1px solid ${bookSide === side ? (side === "YES" ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)") : "transparent"}`,
              }}
            >
              {side}
            </button>
          ))}
        </div>
      )}

      {/* Depth chart */}
      <MarketDepthChart bids={bids} asks={asks} />

      {/* Stats bar */}
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

      {/* Scrollable orderbook */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto ob-scroll relative">
        {[...asks].reverse().map((level, i) => (
          <OBRow key={`a-${i}`} level={level} side="ask" maxCum={maxCumSize} />
        ))}

        <div ref={midRef} className="flex items-center gap-1.5 px-2 py-1 my-px" style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="flex-1 h-px bg-[var(--border)]" />
          <span className="text-[11px] font-bold tabular-nums text-[var(--text)]">
            {data.lastTradePrice > 0 ? data.lastTradePrice.toFixed(3) : data.midPrice.toFixed(3)}
          </span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>

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
