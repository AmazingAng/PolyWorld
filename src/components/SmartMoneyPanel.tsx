"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import type { WhaleTrade, ProcessedMarket } from "@/types";
import type { CategoryFlow } from "@/lib/flowAnalysis";
import { formatVolume } from "@/lib/format";
import { detectSignals } from "@/lib/smartSignals";
import { useI18n } from "@/i18n";

interface SmartMoneyPanelProps {
  smartTrades: WhaleTrade[];
  markets?: ProcessedMarket[];
  walletFilter?: string | null;
  onClearFilter?: () => void;
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

function tradeKey(t: WhaleTrade): string {
  return `${t.wallet}-${t.conditionId}-${t.timestamp}`;
}

type SmartMoneyTab = "trades" | "flow" | "signals";

export default function SmartMoneyPanel({
  smartTrades,
  markets,
  walletFilter,
  onClearFilter,
  onSelectMarket,
  onSelectWallet,
}: SmartMoneyPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SmartMoneyTab>("trades");
  const [flows, setFlows] = useState<CategoryFlow[]>([]);
  const [flowLoading, setFlowLoading] = useState(false);
  const [newTradeThreshold] = useState(() => Date.now() - 60_000);

  const fetchFlows = useCallback(async () => {
    try {
      const res = await fetch("/api/smart-money?view=flow");
      if (!res.ok) return;
      const data = await res.json();
      if (data.flows) setFlows(data.flows);
    } catch { /* non-critical */ }
    setFlowLoading(false);
  }, []);

  const handleTabChange = useCallback((nextTab: SmartMoneyTab) => {
    setTab(nextTab);
    if (nextTab === "flow" && flows.length === 0) {
      setFlowLoading(true);
      void fetchFlows();
    }
  }, [fetchFlows, flows.length]);

  useEffect(() => {
    if (tab !== "flow") return;
    const iv = setInterval(() => {
      void fetchFlows();
    }, 120_000);
    return () => clearInterval(iv);
  }, [fetchFlows, tab]);

  const filteredTrades = useMemo(() => {
    if (!walletFilter) return smartTrades;
    return smartTrades.filter(
      (tr) => tr.wallet.toLowerCase() === walletFilter.toLowerCase()
    );
  }, [smartTrades, walletFilter]);

  return (
    <div className="font-mono">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 mb-2">
        {(["trades", "flow", "signals"] as SmartMoneyTab[]).map((tabId) => (
          <button
            key={tabId}
            onClick={() => handleTabChange(tabId)}
            className={`px-2 py-0.5 text-[10px] font-mono transition-colors ${
              tab === tabId
                ? "text-[var(--text)] bg-[var(--surface-hover)]"
                : "text-[var(--text-faint)] hover:text-[var(--text-muted)]"
            }`}
          >
            {tabId === "trades" ? t("smartMoney.tradesTab") : tabId === "flow" ? t("smartMoney.flowTab") : t("smartMoney.signalsTab")}
          </button>
        ))}
      </div>

      {tab === "signals" ? (
        <SignalsView
          smartTrades={smartTrades}
          markets={markets || []}
          onSelectMarket={onSelectMarket}
          onSelectWallet={onSelectWallet}
        />
      ) : tab === "trades" ? (
        <>
          {walletFilter && (
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="text-[10px] text-[var(--text-faint)]">
                {t("smartMoney.filteringWallet", { wallet: truncAddr(walletFilter) })}
              </span>
              <button
                onClick={onClearFilter}
                className="text-[10px] text-[var(--text-ghost)] hover:text-[var(--text)] transition-colors"
              >
                {t("common.clear")}
              </button>
            </div>
          )}

          {filteredTrades.length === 0 ? (
            <div className="text-[12px] text-[var(--text-ghost)] py-4 text-center">
              {walletFilter ? t("smartMoney.noSmartTrades") : t("smartMoney.syncingSmartTrades")}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredTrades.map((trade, i) => {
                const k = tradeKey(trade);
                const isFresh = new Date(trade.timestamp).getTime() >= newTradeThreshold;
                return (
                  <div
                    key={`${k}-${i}`}
                    className={`smart-money-row${isFresh ? " trade-new" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[var(--text-faint)] shrink-0 tabular-nums w-5 text-right">
                        {timeAgo(trade.timestamp)}
                      </span>
                      <button
                        onClick={() => onSelectWallet?.(trade.wallet)}
                        className="text-[10px] text-[var(--text-muted)] truncate w-16 shrink-0 text-left hover:text-[var(--text)] transition-colors"
                        title={trade.wallet}
                      >
                        {trade.username || truncAddr(trade.wallet)}
                      </button>
                      <button
                        onClick={() => onSelectMarket?.(trade.slug)}
                        className="text-[11px] text-[var(--text-secondary)] truncate flex-1 min-w-0 text-left hover:text-[var(--text)] transition-colors"
                        title={trade.title}
                      >
                        {trade.title}
                      </button>
                      <span
                        className={`text-[11px] font-bold shrink-0 ${
                          trade.side === "BUY" ? "text-[#22c55e]" : "text-[#ff4444]"
                        }`}
                      >
                        {trade.side}
                      </span>
                      <span className="text-[11px] text-[var(--text-dim)] tabular-nums shrink-0">
                        {formatVolume(trade.usdcSize || trade.size)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <FlowView flows={flows} loading={flowLoading} />
      )}
    </div>
  );
}

function FlowView({ flows, loading }: { flows: CategoryFlow[]; loading: boolean }) {
  const { t } = useI18n();
  if (loading && flows.length === 0) {
    return (
      <div className="text-[12px] text-[var(--text-ghost)] py-4 text-center">
        {t("smartMoney.loadingFlowData")}
      </div>
    );
  }

  if (flows.length === 0) {
    return (
      <div className="text-[12px] text-[var(--text-ghost)] py-4 text-center">
        {t("smartMoney.noFlowData")}
      </div>
    );
  }

  const maxAbsVol = Math.max(...flows.map((f) => Math.abs(f.netVolume)), 1);

  return (
    <div className="space-y-0.5">
      {flows.map((f) => {
        const trendColor = f.trend === "bullish" ? "#22c55e" : f.trend === "bearish" ? "#ff4444" : "var(--text-faint)";
        const barPct = Math.min(Math.abs(f.netVolume) / maxAbsVol * 100, 100);
        const isBullish = f.netVolume >= 0;
        return (
          <div key={f.category} className="flex items-center gap-2 px-1.5 py-[4px] border-b border-[var(--border-subtle)] last:border-0">
            {/* Category name */}
            <span className="text-[10px] text-[var(--text-secondary)] w-16 shrink-0 truncate">
              {f.category}
            </span>

            {/* Direction arrow */}
            <span style={{ color: trendColor }} className="text-[11px] font-bold w-4 shrink-0 text-center">
              {f.trend === "bullish" ? "\u2191" : f.trend === "bearish" ? "\u2193" : "\u2194"}
            </span>

            {/* Bar chart — buy/sell comparison */}
            <div className="flex-1 h-3 bg-[var(--bg)] rounded-sm relative overflow-hidden">
              <div
                className="h-full rounded-sm transition-all duration-500"
                style={{
                  width: `${Math.max(barPct, 2)}%`,
                  background: isBullish
                    ? "linear-gradient(90deg, #22c55eaa, #22c55e44)"
                    : "linear-gradient(90deg, #ff4444aa, #ff444444)",
                }}
              />
            </div>

            {/* Net volume */}
            <span className="text-[9px] tabular-nums w-14 text-right shrink-0" style={{ color: trendColor }}>
              {isBullish ? "+" : ""}{formatVolume(Math.abs(f.netVolume))}
            </span>

            {/* Smart ratio */}
            <span className="text-[9px] text-[var(--text-faint)] tabular-nums w-8 text-right shrink-0" title={t("smartMoney.smartWalletRatio")}>
              {(f.smartRatio * 100).toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

const SIGNAL_ICONS: Record<string, string> = {
  whale_accumulation: "\uD83D\uDC33",
  smart_divergence: "\u26A1",
  cluster_activity: "\uD83C\uDFAF",
  momentum_shift: "\uD83D\uDD04",
};

const SIGNAL_LABEL_KEYS: Record<string, string> = {
  whale_accumulation: "smartMoney.smartAccumulation",
  smart_divergence: "smartMoney.smartDivergence",
  cluster_activity: "smartMoney.clusterActivity",
  momentum_shift: "smartMoney.momentumShift",
};

const STRENGTH_COLORS: Record<string, string> = {
  strong: "#ff4444",
  moderate: "#f59e0b",
  weak: "var(--text-faint)",
};

function signalTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SignalsView({
  smartTrades,
  markets,
  onSelectMarket,
  onSelectWallet,
}: {
  smartTrades: WhaleTrade[];
  markets: ProcessedMarket[];
  onSelectMarket?: (slug: string) => void;
  onSelectWallet?: (address: string) => void;
}) {
  const { t } = useI18n();
  const signals = useMemo(
    () => detectSignals(smartTrades, markets),
    [smartTrades, markets]
  );

  if (signals.length === 0) {
    return (
      <div className="text-[12px] text-[var(--text-ghost)] py-4 text-center">
        {t("smartMoney.noSignals6h")}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {signals.map((sig) => (
        <div
          key={sig.id}
          className="border-b border-[var(--border-subtle)] last:border-0 px-1.5 py-[5px]"
        >
          {/* Header row */}
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] shrink-0">{SIGNAL_ICONS[sig.type] || "?"}</span>
            <span
              className="text-[8px] px-1 rounded-sm shrink-0 font-bold uppercase"
              style={{
                color: STRENGTH_COLORS[sig.strength],
                background: sig.strength === "strong" ? "rgba(255,68,68,0.1)" : sig.strength === "moderate" ? "rgba(245,158,11,0.1)" : "rgba(128,128,128,0.1)",
              }}
            >
              {sig.strength}
            </span>
            <span className="text-[10px] text-[var(--text-faint)] shrink-0">
              {t(SIGNAL_LABEL_KEYS[sig.type] || sig.type)}
            </span>
            <span className="text-[9px] text-[var(--text-ghost)] ml-auto shrink-0 tabular-nums">
              {signalTimeAgo(sig.timestamp)}
            </span>
          </div>

          {/* Market title */}
          <button
            onClick={() => onSelectMarket?.(sig.market.slug)}
            className="text-[11px] text-[var(--text-secondary)] truncate w-full text-left hover:text-[var(--text)] transition-colors mt-0.5"
            title={sig.market.title}
          >
            {sig.market.title}
          </button>

          {/* Details row */}
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[10px] font-bold ${sig.direction === "bullish" ? "text-[#22c55e]" : "text-[#ff4444]"}`}>
              {sig.direction === "bullish" ? "\u2191 BULLISH" : "\u2193 BEARISH"}
            </span>
            <span className="text-[9px] text-[var(--text-faint)]">
              {sig.wallets.length !== 1 ? t("smartMoney.walletsCount", { count: sig.wallets.length }) : t("smartMoney.walletCount", { count: sig.wallets.length })}
            </span>
            {sig.details.totalVolume && (
              <span className="text-[9px] text-[var(--text-dim)] tabular-nums">
                ${formatVolume(sig.details.totalVolume)}
              </span>
            )}
            {sig.wallets.length > 0 && (
              <button
                onClick={() => onSelectWallet?.(sig.wallets[0].address)}
                className="text-[9px] text-[var(--text-ghost)] hover:text-[var(--text)] transition-colors ml-auto"
                title={sig.wallets[0].address}
              >
                {sig.wallets[0].username || `${sig.wallets[0].address.slice(0, 6)}...${sig.wallets[0].address.slice(-4)}`}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
