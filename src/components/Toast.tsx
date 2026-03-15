"use client";

import { ProcessedMarket } from "@/types";
import { formatChange } from "@/lib/format";
import { useToastStore } from "@/stores/toastStore";

interface ToastProps {
  onSelectMarket?: (market: ProcessedMarket) => void;
}

export default function ToastContainer({ onSelectMarket }: ToastProps) {
  const tradeToasts = useToastStore((s) => s.tradeToasts);
  const marketToasts = useToastStore((s) => s.marketToasts);
  const dismissTradeToast = useToastStore((s) => s.dismissTradeToast);
  const dismissMarketToast = useToastStore((s) => s.dismissMarketToast);

  if (tradeToasts.length === 0 && marketToasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-[50px] right-4 z-[2000] flex flex-col gap-1 pointer-events-none"
    >
      {tradeToasts.map((t) => {
        const borderColor =
          t.type === "success"    ? "border-l-[#22c55e]"  :
          t.type === "submitting" ? "border-l-[#f59e0b]"  :
                                    "border-l-[#ff4444]";
        const labelColor =
          t.type === "success"    ? "text-[#22c55e]"  :
          t.type === "submitting" ? "text-[#f59e0b]"  :
                                    "text-[#ff4444]";
        return (
          <div
            key={t.id}
            onClick={() => dismissTradeToast(t.id)}
            className={`bg-[#141414] border border-[#2a2a2a] border-l-2 ${borderColor} px-3 py-2 text-[12px] font-mono animate-toast-in pointer-events-auto max-w-[300px] cursor-pointer hover:bg-[#1a1a1a] transition-colors`}
            title="Dismiss"
          >
            <div className={`text-[13px] uppercase tracking-[0.15em] mb-1 ${labelColor}`}>{t.label}</div>
            <div className="text-[#ccc]">{t.title}</div>
            {t.detail && <div className="mt-0.5 text-[#777] text-[11px] font-mono">{t.detail}</div>}
          </div>
        );
      })}
      {marketToasts.map((toast) => {
        if (toast.type === "batch") {
          return (
            <div
              key={toast.id}
              onClick={() => dismissMarketToast(toast.id)}
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
              onClick={() => {
                if (toast.market && onSelectMarket) onSelectMarket(toast.market);
                dismissMarketToast(toast.id);
              }}
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
            onClick={() => {
              if (toast.market && onSelectMarket) onSelectMarket(toast.market);
              dismissMarketToast(toast.id);
            }}
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
