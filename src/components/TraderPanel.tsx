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
  const [tab, setTab] = useState<"positions" | "activity">("positions");
  const [positions, setPositions] = useState<TraderPosition[]>([]);
  const [activity, setActivity] = useState<TraderActivity[]>([]);
  const [totalValue, setTotalValue] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedWallet) {
      setPositions([]);
      setActivity([]);
      setTotalValue(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchTraderPositions(selectedWallet),
      fetchTraderActivity(selectedWallet),
      fetchTraderValue(selectedWallet),
    ]).then(([pos, act, val]) => {
      if (cancelled) return;
      setPositions(pos);
      setActivity(act);
      setTotalValue(val);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedWallet]);

  const openPositions = positions.filter((p) => !p.redeemed);
  const closedPositions = positions.filter((p) => p.redeemed);
  const totalPnl = positions.reduce((s, p) => s + p.cashPnl, 0);

  return (
    <div className="flex flex-col h-full font-mono text-[11px]">
      {!selectedWallet ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center text-[var(--text-muted)] leading-relaxed">
            <div className="mb-1">paste a 0x address above, or</div>
            <div>click a wallet in <span className="text-[var(--text-dim)]">Leaderboard</span>, <span className="text-[var(--text-dim)]">Smart Trades</span>, or <span className="text-[var(--text-dim)]">Whale Trades</span></div>
          </div>
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
          <div className="w-4 h-4 border border-[#2a2a2a] border-t-[#a0a0a0] rounded-full animate-spin mr-2" />
          loading…
        </div>
      ) : (
        <>
          {/* Stats bar */}
          <div className="flex items-center gap-3 px-2 py-1.5 border-b border-[var(--border)] text-[10px] tabular-nums">
            <div>
              <span className="text-[var(--text-muted)]">VALUE </span>
              <span className="text-[var(--text)]">{formatVolume(totalValue)}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">PNL </span>
              <span style={{ color: totalPnl >= 0 ? "#22c55e" : "#ff4444" }}>
                {totalPnl >= 0 ? "+" : ""}{formatVolume(totalPnl)}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">{openPositions.length} open</span>
              <span className="text-[var(--text-ghost)]"> / </span>
              <span className="text-[var(--text-muted)]">{closedPositions.length} closed</span>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-[var(--border)]">
            {(["positions", "activity"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-3 py-1 text-[10px] uppercase tracking-wider transition-colors"
                style={{
                  color: tab === t ? "#22c55e" : "var(--text-faint)",
                  borderBottom: tab === t ? "1px solid #22c55e" : "1px solid transparent",
                }}
              >
                {t}
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
                      Open ({openPositions.length})
                    </div>
                    {openPositions.map((p, i) => (
                      <PositionRow key={`o-${i}`} position={p} />
                    ))}
                  </>
                )}
                {closedPositions.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-[9px] text-[var(--text-muted)] uppercase tracking-wider bg-[var(--bg-panel)]">
                      Closed ({closedPositions.length})
                    </div>
                    {closedPositions.map((p, i) => (
                      <PositionRow key={`c-${i}`} position={p} dimmed />
                    ))}
                  </>
                )}
                {positions.length === 0 && (
                  <div className="px-2 py-4 text-center text-[var(--text-muted)]">no positions</div>
                )}
              </div>
            ) : (
              <div>
                {activity.length > 0 ? (
                  activity.map((a, i) => <ActivityRow key={i} activity={a} />)
                ) : (
                  <div className="px-2 py-4 text-center text-[var(--text-muted)]">no activity</div>
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
