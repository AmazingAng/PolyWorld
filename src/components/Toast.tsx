"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ProcessedMarket } from "@/types";
import { formatChange } from "@/lib/format";
import { useToastStore } from "@/stores/toastStore";
import { useI18n } from "@/i18n";

interface ToastProps {
  onSelectMarket?: (market: ProcessedMarket) => void;
}

export default function ToastContainer({ onSelectMarket }: ToastProps) {
  const { t } = useI18n();
  const tradeToasts = useToastStore((s) => s.tradeToasts);
  const marketToasts = useToastStore((s) => s.marketToasts);
  const dismissTradeToast = useToastStore((s) => s.dismissTradeToast);
  const dismissMarketToast = useToastStore((s) => s.dismissMarketToast);

  // Portal requires DOM — wait for mount
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration guard for portal
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;
  if (tradeToasts.length === 0 && marketToasts.length === 0) return null;

  const content = (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-[54px] right-4 flex flex-col gap-2 pointer-events-none"
      style={{ zIndex: 10001 }}
    >
      {tradeToasts.map((toast) => {
        const isSuccess = toast.type === "success";
        const isError = toast.type === "error";
        const accentColor = isSuccess ? "#22c55e" : isError ? "#ff4444" : "#f59e0b";

        if (isSuccess) {
          return (
            <div
              key={toast.id}
              onClick={() => dismissTradeToast(toast.id)}
              className="pointer-events-auto cursor-pointer font-mono animate-toast-in"
              style={{
                background: "linear-gradient(135deg, #0d1f14 0%, #111 100%)",
                border: `1px solid ${accentColor}55`,
                borderLeft: `3px solid ${accentColor}`,
                borderRadius: 4,
                padding: "12px 14px",
                minWidth: 260,
                maxWidth: 320,
                boxShadow: `0 0 0 1px ${accentColor}18, 0 8px 32px rgba(0,0,0,0.6), 0 0 20px ${accentColor}15`,
              }}
              title={t("common.dismiss")}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span style={{ color: accentColor, fontSize: 16, lineHeight: 1 }}>✓</span>
                <span style={{ color: accentColor, fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 700 }}>
                  {toast.label}
                </span>
              </div>
              <div style={{ color: "#e5e5e5", fontSize: 12 }}>{toast.title}</div>
              {toast.detail && (
                <div style={{ color: "#666", fontSize: 11, marginTop: 4 }}>{toast.detail}</div>
              )}
            </div>
          );
        }

        const borderColor = isError ? "#ff4444" : "#f59e0b";
        const labelColor = isError ? "#ff4444" : "#f59e0b";
        return (
          <div
            key={toast.id}
            onClick={() => dismissTradeToast(toast.id)}
            className={`bg-[#141414] border border-[#2a2a2a] border-l-2 px-3 py-2 text-[12px] font-mono animate-toast-in pointer-events-auto max-w-[300px] cursor-pointer hover:bg-[#1a1a1a] transition-colors`}
            style={{ borderLeftColor: borderColor, borderRadius: 4 }}
            title="Dismiss"
          >
            <div style={{ color: labelColor, fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>
              {toast.label}
            </div>
            <div className="text-[#ccc]">{toast.title}</div>
            {toast.detail && <div className="mt-0.5 text-[#777] text-[11px] font-mono">{toast.detail}</div>}
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
              style={{ borderRadius: 4 }}
              title={t("common.dismiss")}
            >
              <div className="text-[13px] uppercase tracking-[0.15em] mb-1 text-[#22c55e]">
                {t("toast.newMarkets")}
              </div>
              <div className="text-[#ccc]">
                {t("toast.newMarketsDetected", { count: toast.batchCount ?? 0 })}
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
              style={{ borderRadius: 4 }}
              title={t("toast.clickToViewMarket")}
            >
              <div className="text-[13px] uppercase tracking-[0.15em] mb-1 text-[#22c55e]">
                {t("toast.newMarket")}
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
            title={t("toast.clickToViewMarket")}
            className={`bg-[#141414] border border-[#2a2a2a] px-3 py-2 text-[12px] font-mono animate-toast-in pointer-events-auto max-w-[300px] cursor-pointer hover:bg-[#1a1a1a] transition-colors ${
              isAnomalous
                ? "border-l-2 border-l-[#f59e0b]"
                : chg.cls === "up"
                ? "border-l-2 border-l-[#22c55e]"
                : "border-l-2 border-l-[#ff4444]"
            }`}
            style={{ borderRadius: 4 }}
          >
            <div
              className={`text-[13px] uppercase tracking-[0.15em] mb-1 ${
                isAnomalous ? "text-[#f59e0b]" : chg.cls === "up" ? "text-[#22c55e]" : "text-[#ff4444]"
              }`}
            >
              {isAnomalous ? t("toast.unusual") : t("toast.signal")}
            </div>
            <div className="text-[#ccc] line-clamp-1">
              {toast.market?.title}
            </div>
            <div className="mt-1">
              <span className={chg.cls === "up" ? "text-[#22c55e]" : "text-[#ff4444]"}>
                {chg.text}
              </span>
              {isAnomalous && anomaly && (
                <span className="text-[#f59e0b] ml-1">
                  (z={anomaly.zScore}{anomaly.volumeSpike ? `, ${t("toast.volSpike")}` : ""})
                </span>
              )}
              <span className="text-[#8a8a8a] ml-1">{t("toast.lastRefresh")}</span>
            </div>
          </div>
        );
      })}
    </div>
  );

  return createPortal(content, document.body);
}
