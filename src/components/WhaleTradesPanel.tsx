"use client";

import { useState, useMemo } from "react";
import type { WhaleTrade } from "@/types";
import { formatVolume } from "@/lib/format";
import { useI18n } from "@/i18n";

interface WhaleTradesPanelProps {
  trades: WhaleTrade[];
  onSelectMarket?: (slug: string) => void;
  onSelectWallet?: (address: string) => void;
}

function truncAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function WhaleTradesPanel({
  trades,
  onSelectMarket,
  onSelectWallet,
}: WhaleTradesPanelProps) {
  const { t } = useI18n();
  const [walletFilter, setWalletFilter] = useState<string | null>(null);
  const [newTradeThreshold] = useState(() => Date.now() - 60_000);

  const filteredTrades = useMemo(() => {
    if (!walletFilter) return trades;
    return trades.filter(
      (t) => t.wallet.toLowerCase() === walletFilter.toLowerCase()
    );
  }, [trades, walletFilter]);

  return (
    <div className="font-mono">
      {walletFilter && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="text-[10px] text-[var(--text-faint)]">
            {t("whaleTrades.filteringWallet", { wallet: truncAddr(walletFilter) })}
          </span>
          <button
            onClick={() => setWalletFilter(null)}
            className="text-[10px] text-[var(--text-ghost)] hover:text-[var(--text)] transition-colors"
          >
            {t("common.clear")}
          </button>
        </div>
      )}

      {filteredTrades.length === 0 ? (
        <div className="text-[12px] text-[var(--text-ghost)] py-4 text-center">
          {walletFilter ? t("whaleTrades.noWhaleTrades") : t("whaleTrades.syncingWhaleTrades")}
        </div>
      ) : (
        <div className="space-y-0.5">
          {filteredTrades.map((tr, i) => {
            const k = `${tr.wallet}-${tr.conditionId}-${tr.timestamp}`;
            const isFresh = new Date(tr.timestamp).getTime() >= newTradeThreshold;
            return (
              <div
                key={`${k}-${i}`}
                className={`smart-money-row${isFresh ? " trade-new" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--text-faint)] shrink-0 tabular-nums w-5 text-right">
                    {timeAgo(tr.timestamp)}
                  </span>
                  <button
                    onClick={() => { setWalletFilter(tr.wallet); onSelectWallet?.(tr.wallet); }}
                    className="text-[10px] text-[var(--text-muted)] truncate w-16 shrink-0 text-left hover:text-[var(--text)] transition-colors"
                    title={tr.wallet}
                  >
                    {tr.username || truncAddr(tr.wallet)}
                  </button>
                  <button
                    onClick={() => onSelectMarket?.(tr.slug)}
                    className="text-[11px] text-[var(--text-secondary)] truncate flex-1 min-w-0 text-left hover:text-[var(--text)] transition-colors"
                    title={tr.title}
                  >
                    {tr.title}
                  </button>
                  <span
                    className={`text-[11px] font-bold shrink-0 ${
                      tr.side === "BUY" ? "text-[#22c55e]" : "text-[#ff4444]"
                    }`}
                  >
                    {tr.side}
                  </span>
                  <span className="text-[11px] text-[var(--text-dim)] tabular-nums shrink-0">
                    {formatVolume(tr.usdcSize || tr.size)}
                  </span>
                  {tr.isSmartWallet && (
                    <span className="smart-money-badge" title={t("whaleTrades.smartWallet")}>$</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
