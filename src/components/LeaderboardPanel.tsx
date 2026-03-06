"use client";

import type { SmartWallet } from "@/types";
import { formatVolume } from "@/lib/format";

interface LeaderboardPanelProps {
  leaderboard: SmartWallet[];
  onSelectWallet?: (address: string) => void;
}

function truncAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function LeaderboardPanel({
  leaderboard,
  onSelectWallet,
}: LeaderboardPanelProps) {
  if (leaderboard.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--text-ghost)] py-4 text-center">
        syncing leaderboard...
      </div>
    );
  }

  return (
    <div className="font-mono space-y-0.5">
      {leaderboard.map((w) => (
        <button
          key={w.address}
          onClick={() => onSelectWallet?.(w.address)}
          className="smart-money-row w-full text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-faint)] w-5 text-right shrink-0 tabular-nums">
              #{w.rank}
            </span>
            {w.profileImage ? (
              <img
                src={w.profileImage}
                alt=""
                className="w-4 h-4 rounded-full shrink-0"
              />
            ) : (
              <span className="w-4 h-4 rounded-full bg-[var(--border)] shrink-0" />
            )}
            <span className="text-[11px] text-[var(--text-secondary)] truncate min-w-0 flex-1">
              {w.username || truncAddr(w.address)}
            </span>
            <span className="text-[11px] text-[#22c55e] tabular-nums shrink-0">
              {formatVolume(w.pnl)} PnL
            </span>
            <span className="text-[10px] text-[var(--text-faint)] tabular-nums shrink-0">
              {formatVolume(w.volume)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
