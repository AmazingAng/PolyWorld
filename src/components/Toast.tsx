"use client";

import { useEffect, useState } from "react";
import { ProcessedMarket } from "@/types";
import { formatChange } from "@/lib/format";

interface ToastProps {
  signals: ProcessedMarket[];
  newMarkets: ProcessedMarket[];
  mapWidthPct?: number;
  onSelectMarket?: (market: ProcessedMarket) => void;
}

interface ToastItem {
  id: string;
  market?: ProcessedMarket;
  type: "signal" | "new" | "batch";
  timestamp: number;
  batchCount?: number;
}

export default function ToastContainer({ signals, newMarkets, mapWidthPct = 55, onSelectMarket }: ToastProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    if (signals.length === 0) return;
    const items: ToastItem[] = signals.map((m) => ({
      id: `sig-${m.id}-${Date.now()}`,
      market: m,
      type: "signal",
      timestamp: Date.now(),
    }));
    setToasts((prev) => [...items, ...prev].slice(0, 6));
  }, [signals]);

  useEffect(() => {
    if (newMarkets.length === 0) return;

    // Batch grouping: if >3 new markets, show summary toast
    if (newMarkets.length > 3) {
      const batchItem: ToastItem = {
        id: `batch-${Date.now()}`,
        type: "batch",
        timestamp: Date.now(),
        batchCount: newMarkets.length,
      };
      // Also show first 2 individual items
      const individual: ToastItem[] = newMarkets.slice(0, 2).map((m) => ({
        id: `new-${m.id}-${Date.now()}`,
        market: m,
        type: "new" as const,
        timestamp: Date.now(),
      }));
      setToasts((prev) => [batchItem, ...individual, ...prev].slice(0, 6));
    } else {
      const items: ToastItem[] = newMarkets.slice(0, 3).map((m) => ({
        id: `new-${m.id}-${Date.now()}`,
        market: m,
        type: "new",
        timestamp: Date.now(),
      }));
      setToasts((prev) => [...items, ...prev].slice(0, 6));
    }
  }, [newMarkets]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts((prev) =>
        prev.filter((t) => {
          const ttl = t.type === "new" || t.type === "batch" ? 15000 : 10000;
          return Date.now() - t.timestamp < ttl;
        })
      );
    }, 10000);
    return () => clearTimeout(timer);
  }, [toasts]);

  const dismiss = (id: string, market?: ProcessedMarket) => {
    if (market && onSelectMarket) onSelectMarket(market);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-[50px] z-[2000] flex flex-col gap-1 pointer-events-none max-md:right-auto max-md:left-1/2 max-md:-translate-x-1/2"
      style={{ right: `calc(${100 - mapWidthPct}% + 16px)` }}
    >
      {toasts.map((toast) => {
        if (toast.type === "batch") {
          return (
            <div
              key={toast.id}
              onClick={() => dismiss(toast.id)}
              className="bg-[#141414] border border-[#2a2a2a] border-l-2 border-l-[#22c55e] px-3 py-2 text-[12px] font-mono animate-toast-in pointer-events-auto max-w-[300px] cursor-pointer hover:bg-[#1a1a1a] transition-colors"
              title="Dismiss"
            >
              <div className="text-[13px] uppercase tracking-[0.15em] mb-1 text-[#22c55e]">
                new markets
              </div>
              <div className="text-[#ccc]">
                {toast.batchCount} new markets detected
              </div>
            </div>
          );
        }

        if (toast.type === "new") {
          return (
            <div
              key={toast.id}
              onClick={() => dismiss(toast.id, toast.market)}
              className="bg-[#141414] border border-[#2a2a2a] border-l-2 border-l-[#22c55e] px-3 py-2 text-[12px] font-mono animate-toast-in pointer-events-auto max-w-[300px] cursor-pointer hover:bg-[#1a1a1a] transition-colors"
              title="Click to view market"
            >
              <div className="text-[13px] uppercase tracking-[0.15em] mb-1 text-[#22c55e]">
                new market
              </div>
              <div className="text-[#ccc] line-clamp-1">
                {toast.market?.title}
              </div>
              <div className="mt-1 text-[#777]">
                {toast.market?.category.toLowerCase()}
                {toast.market?.location && ` · ${toast.market.location.toLowerCase()}`}
              </div>
            </div>
          );
        }

        const chg = formatChange(toast.market?.recentChange ?? null);
        const anomaly = toast.market?.anomaly;
        const isAnomalous = anomaly?.isAnomaly;
        return (
          <div
            key={toast.id}
            onClick={() => dismiss(toast.id, toast.market)}
            title="Click to view market"
            className={`bg-[#141414] border border-[#2a2a2a] px-3 py-2 text-[12px] font-mono animate-toast-in pointer-events-auto max-w-[300px] cursor-pointer hover:bg-[#1a1a1a] transition-colors ${
              isAnomalous
                ? "border-l-2 border-l-[#f59e0b]"
                : chg.cls === "up"
                ? "border-l-2 border-l-[#22c55e]"
                : "border-l-2 border-l-[#ff4444]"
            }`}
          >
            <div
              className={`text-[13px] uppercase tracking-[0.15em] mb-1 ${
                isAnomalous ? "text-[#f59e0b]" : chg.cls === "up" ? "text-[#22c55e]" : "text-[#ff4444]"
              }`}
            >
              {isAnomalous ? "unusual" : "signal"}
            </div>
            <div className="text-[#ccc] line-clamp-1">
              {toast.market?.title}
            </div>
            <div className="mt-1">
              <span
                className={
                  chg.cls === "up" ? "text-[#22c55e]" : "text-[#ff4444]"
                }
              >
                {chg.text}
              </span>
              {isAnomalous && anomaly && (
                <span className="text-[#f59e0b] ml-1">
                  (z={anomaly.zScore}{anomaly.volumeSpike ? ", vol spike" : ""})
                </span>
              )}
              <span className="text-[#8a8a8a] ml-1">last refresh</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
