"use client";

import Image from "next/image";
import { useState, useRef, useCallback } from "react";
import type { SmartWallet } from "@/types";
import { formatVolume } from "@/lib/format";
import { useI18n } from "@/i18n";

export type LeaderboardPeriod = "day" | "week" | "month" | "all";

const PAGE_SIZE = 20;

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
  const leaderboardKey = `${leaderboard.length}:${leaderboard.slice(0, 5).map((w) => w.address).join("|")}`;
  return (
    <LeaderboardPanelContent
      key={leaderboardKey}
      leaderboard={leaderboard}
      onSelectWallet={onSelectWallet}
    />
  );
}

function LeaderboardPanelContent({
  leaderboard,
  onSelectWallet,
}: LeaderboardPanelProps) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Intersection observer for infinite scroll
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelCallback = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect();
      if (!node) return;
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            setVisible((v) => Math.min(v + PAGE_SIZE, leaderboard.length));
          }
        },
        { threshold: 0.1 },
      );
      observerRef.current.observe(node);
    },
    [leaderboard.length],
  );

  if (leaderboard.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--text-ghost)] py-4 text-center">
        {t("leaderboard.syncing")}
      </div>
    );
  }

  const shown = leaderboard.slice(0, visible);
  const hasMore = visible < leaderboard.length;

  return (
    <div className="font-mono space-y-0.5">
      {shown.map((w) => (
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
              <Image
                src={w.profileImage}
                alt=""
                width={16}
                height={16}
                unoptimized
                className="w-4 h-4 rounded-full shrink-0"
              />
            ) : (
              <span className="w-4 h-4 rounded-full bg-[var(--border)] shrink-0" />
            )}
            <span className="text-[11px] text-[var(--text-secondary)] truncate min-w-0 flex-1">
              {w.username || truncAddr(w.address)}
            </span>
            <span className={`text-[11px] tabular-nums shrink-0 ${w.pnl >= 0 ? "text-[#22c55e]" : "text-[#ff4444]"}`}>
              {w.pnl < 0 ? "-" : ""}{formatVolume(Math.abs(w.pnl))} {t("leaderboard.pnl")}
            </span>
            <span className="text-[10px] text-[var(--text-faint)] tabular-nums shrink-0">
              {formatVolume(w.volume)}
            </span>
          </div>
        </button>
      ))}
      {hasMore && (
        <div ref={sentinelCallback} className="h-4" />
      )}
    </div>
  );
}
