"use client";

import { useState, useEffect } from "react";
import {
  TraderPosition,
  TraderActivity,
  fetchTraderPositions,
  fetchTraderActivity,
  fetchTraderValue,
} from "@/lib/smartMoney";
import { formatVolume } from "@/lib/format";
import { useI18n } from "@/i18n";

interface TraderPanelProps {
  selectedWallet: string | null;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return "<1m";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function truncAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function TraderPanel({
  selectedWallet,
}: TraderPanelProps) {
  if (!selectedWallet) {
    return (
      <TraderPanelContent
        key="empty"
        selectedWallet={null}
      />
    );
  }

  return (
    <TraderPanelContent
      key={selectedWallet}
      selectedWallet={selectedWallet}
    />
  );
}

function TraderPanelContent({
  selectedWallet,
}: TraderPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"positions" | "activity">("positions");
  const [positions, setPositions] = useState<TraderPosition[]>([]);
  const [activity, setActivity] = useState<TraderActivity[]>([]);
  const [totalValue, setTotalValue] = useState<number>(0);
  const [loading, setLoading] = useState(Boolean(selectedWallet));

  useEffect(() => {
    if (!selectedWallet) return;
    const wallet = selectedWallet;
    let cancelled = false;
    async function loadTraderData() {
      try {
        const [pos, act, val] = await Promise.all([
          fetchTraderPositions(wallet),
          fetchTraderActivity(wallet),
          fetchTraderValue(wallet),
        ]);
        if (cancelled) return;
        setPositions(pos);
        setActivity(act);
        setTotalValue(val);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    loadTraderData();
    return () => { cancelled = true; };
  }, [selectedWallet]);

  const displayedPositions = selectedWallet ? positions : [];
  const displayedActivity = selectedWallet ? activity : [];
  const displayedValue = selectedWallet ? totalValue : 0;
  const openPositions = displayedPositions.filter((p) => !p.redeemed);
  const closedPositions = displayedPositions.filter((p) => p.redeemed);
  const totalPnl = displayedPositions.reduce((s, p) => s + p.cashPnl, 0);

  return (
    <div className="flex flex-col h-full font-mono text-[11px]">
      {!selectedWallet ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center text-[var(--text-muted)] leading-relaxed">
            <div className="mb-1">{t("traderPanel.pasteAddress")}</div>
            <div>{t("traderPanel.clickWallet")}</div>
          </div>
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
          <div className="w-4 h-4 border border-[#2a2a2a] border-t-[#a0a0a0] rounded-full animate-spin mr-2" />
          {t("common.loading")}
        </div>
      ) : (
        <>
          {/* Stats bar */}
          <div className="flex items-center gap-3 px-2 py-1.5 border-b border-[var(--border)] text-[10px] tabular-nums">
            <div>
              <span className="text-[var(--text-muted)]">{t("traderPanel.value")} </span>
              <span className="text-[var(--text)]">{formatVolume(displayedValue)}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">{t("traderPanel.pnl")} </span>
              <span style={{ color: totalPnl >= 0 ? "#22c55e" : "#ff4444" }}>
                {totalPnl >= 0 ? "+" : ""}{formatVolume(totalPnl)}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">{openPositions.length} {t("traderPanel.open")}</span>
              <span className="text-[var(--text-ghost)]"> / </span>
              <span className="text-[var(--text-muted)]">{closedPositions.length} {t("traderPanel.closed")}</span>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-[var(--border)]">
            {(["positions", "activity"] as const).map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                className="px-3 py-1 text-[10px] uppercase tracking-wider transition-colors"
                style={{
                  color: tab === tabKey ? "#22c55e" : "var(--text-faint)",
                  borderBottom: tab === tabKey ? "1px solid #22c55e" : "1px solid transparent",
                }}
              >
                {t(tabKey === "positions" ? "traderPanel.positionsTab" : "traderPanel.activityTab")}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {tab === "positions" ? (
              <div>
                {openPositions.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-[9px] text-[var(--text-muted)] uppercase tracking-wider bg-[var(--bg-panel)]">
                      {t("traderPanel.openCount", { count: openPositions.length })}
                    </div>
                    {openPositions.map((p, i) => (
                      <PositionRow key={`o-${i}`} position={p} />
                    ))}
                  </>
                )}
                {closedPositions.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-[9px] text-[var(--text-muted)] uppercase tracking-wider bg-[var(--bg-panel)]">
                      {t("traderPanel.closedCount", { count: closedPositions.length })}
                    </div>
                    {closedPositions.map((p, i) => (
                      <PositionRow key={`c-${i}`} position={p} dimmed />
                    ))}
                  </>
                )}
                {displayedPositions.length === 0 && (
                  <div className="px-2 py-4 text-center text-[var(--text-muted)]">{t("traderPanel.noPositions")}</div>
                )}
              </div>
            ) : (
              <div>
                {displayedActivity.length > 0 ? (
                  displayedActivity.map((a, i) => <ActivityRow key={i} activity={a} />)
                ) : (
                  <div className="px-2 py-4 text-center text-[var(--text-muted)]">{t("traderPanel.noActivity")}</div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PositionRow({ position: p, dimmed }: { position: TraderPosition; dimmed?: boolean }) {
  return (
    <div
      className="smart-money-row px-2 py-1 flex items-center gap-2 tabular-nums"
      style={{ opacity: dimmed ? 0.5 : 1 }}
    >
      <div className="flex-1 min-w-0 truncate text-[var(--text)]" title={p.title}>
        {p.title || truncAddr(p.conditionId)}
      </div>
      <span className="text-[var(--text-dim)] w-[28px] text-right shrink-0">{p.outcome}</span>
      <span className="text-[var(--text)] w-[48px] text-right shrink-0">{formatVolume(p.currentValue)}</span>
      <span
        className="w-[52px] text-right shrink-0"
        style={{ color: p.cashPnl >= 0 ? "#22c55e" : "#ff4444" }}
      >
        {p.cashPnl >= 0 ? "+" : ""}{formatVolume(p.cashPnl)}
      </span>
    </div>
  );
}

function ActivityRow({ activity: a }: { activity: TraderActivity }) {
  const typeBadgeColors: Record<string, string> = {
    TRADE: "#3b82f6",
    REDEEM: "#22c55e",
    SPLIT: "#777",
    MERGE: "#777",
  };
  const badgeColor = typeBadgeColors[a.type] || "#777";

  return (
    <div className="smart-money-row px-2 py-1 flex items-center gap-1.5 tabular-nums">
      <span className="text-[var(--text-ghost)] w-[24px] shrink-0 text-right">{timeAgo(a.timestamp)}</span>
      <span
        className="text-[9px] px-1 rounded-sm shrink-0"
        style={{ color: badgeColor, border: `1px solid ${badgeColor}40` }}
      >
        {a.type}
      </span>
      <div className="flex-1 min-w-0 truncate text-[var(--text)]" title={a.title}>
        {a.title}
      </div>
      <span
        className="text-[10px] shrink-0"
        style={{ color: a.side === "BUY" ? "#22c55e" : "#ff4444" }}
      >
        {a.side}
      </span>
      <span className="text-[var(--text)] w-[48px] text-right shrink-0">{formatVolume(a.usdcSize)}</span>
    </div>
  );
}
