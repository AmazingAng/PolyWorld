"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import AlertManager from "./AlertManager";

const WalletButton = dynamic(() => import("./WalletButton"), { ssr: false });
import type { AlertConfig, AlertHistoryEntry } from "@/hooks/useAlerts";
import type { ProcessedMarket } from "@/types";

interface HeaderProps {
  lastRefresh: string | null;
  dataMode: "live" | "sample";
  loading: boolean;
  onRefresh: () => void;
  marketCount: number;
  globalCount: number;
  lastSyncTime?: string | null;
  onOpenSettings: () => void;
  watchedCount?: number;
  alertUnreadCount?: number;
  autoRefresh?: boolean;
  refreshError?: boolean;
  onTrade?: (state: import("./TradeModal").TradeModalState) => void;
  onTradePosition?: (title: string, outcome: string) => void;
  // Alert manager props
  alertManagerOpen?: boolean;
  onOpenAlertManager?: () => void;
  onCloseAlertManager?: () => void;
  alertProps?: {
    alerts: AlertConfig[];
    history: AlertHistoryEntry[];
    onAddAlert: (config: Omit<AlertConfig, "id" | "createdAt" | "enabled">) => void;
    onRemoveAlert: (id: string) => void;
    onToggleAlert: (id: string) => void;
    onMarkRead: (id: string) => void;
    onMarkAllRead: () => void;
    onClearHistory: () => void;
    allMarkets: ProcessedMarket[];
    prefill?: { marketId?: string; marketTitle?: string };
    notifPermission: NotificationPermission;
    onRequestPermission: () => void;
  };
}

function getRelativeTime(iso: string): { text: string; stale: boolean } {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return { text: `${secs}s ago`, stale: false };
  const mins = Math.floor(secs / 60);
  if (mins < 5) return { text: `${mins}m ago`, stale: false };
  if (mins < 60) return { text: `${mins}m ago`, stale: true };
  return { text: `${Math.floor(mins / 60)}h ago`, stale: true };
}

function UTCClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      const day = days[now.getUTCDay()];
      const dd = now.getUTCDate().toString().padStart(2, "0");
      const mon = months[now.getUTCMonth()];
      const h = now.getUTCHours().toString().padStart(2, "0");
      const m = now.getUTCMinutes().toString().padStart(2, "0");
      const s = now.getUTCSeconds().toString().padStart(2, "0");
      setTime(`${day}, ${dd} ${mon} ${h}:${m}:${s} UTC`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-[11px] text-[var(--text-faint)] tabular-nums hidden sm:inline">{time}</span>;
}

export default function Header({
  lastRefresh: _lastRefresh,
  dataMode: _dataMode,
  loading,
  onRefresh,
  marketCount,
  globalCount,
  lastSyncTime,
  onOpenSettings,
  watchedCount: _watchedCount = 0,
  alertUnreadCount = 0,
  alertManagerOpen,
  onOpenAlertManager,
  onCloseAlertManager,
  alertProps,
  autoRefresh = false,
  refreshError: _refreshError = false,
  onTrade,
  onTradePosition,
}: HeaderProps) {
  void _lastRefresh; void _dataMode; void _watchedCount; void _refreshError;
  const _syncInfo = lastSyncTime ? getRelativeTime(lastSyncTime) : null;
  void _syncInfo;
  const bellRef = useRef<HTMLButtonElement>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration guard
  useEffect(() => { setMounted(true); return () => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current); }; }, []);
  const progressKey = `${loading ? "loading" : "idle"}:${lastSyncTime ?? "none"}`;

  return (
    <header className="h-[48px] bg-[var(--bg)] border-b border-[var(--border-subtle)] flex items-center pl-4 pr-3 z-50 shrink-0 font-mono relative">
      {/* Left: Logo + stats */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--status-live)] shrink-0 w-6 h-6 sm:w-7 sm:h-7" aria-hidden="true">
            <polygon points="22,12 17,3.4 7,3.4 2,12 7,20.6 17,20.6" />
            <path d="M2 12h20M12 3.4L16 12l-4 8.6M12 3.4L8 12l4 8.6" />
          </svg>
          <span style={{ fontFamily: "'Inter Tight', sans-serif", fontWeight: 800, letterSpacing: '-0.02em' }} className="text-[16px] sm:text-[19px] text-[var(--text)] whitespace-nowrap">
            PolyWorld
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] ml-1">
          <span>
            <strong className="text-[var(--text-secondary)]">{marketCount}</strong> mapped
          </span>
          <span className="text-[var(--border)]">|</span>
          <span>
            <strong className="text-[var(--text-secondary)]">{globalCount}</strong> global
          </span>
        </div>
      </div>

      <div className="flex-1" />

      {/* Center: UTC clock */}
      <UTCClock />

      <div className="flex-1" />

      {/* Right: Alerts + Wallet + Settings */}
      <div className="flex items-center gap-1.5 text-[11px]">
        {/* Alert bell + dropdown — opens on hover */}
        {onOpenAlertManager && (
          <div
            className="relative"
            onMouseEnter={() => {
              if (hoverTimeout.current) { clearTimeout(hoverTimeout.current); hoverTimeout.current = null; }
              if (!alertManagerOpen) onOpenAlertManager();
            }}
            onMouseLeave={() => {
              hoverTimeout.current = setTimeout(() => {
                onCloseAlertManager?.();
              }, 300);
            }}
          >
            <button
              ref={bellRef}
              onClick={onOpenAlertManager}
              className={`relative flex items-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors px-1 ${alertManagerOpen ? "text-[var(--text)]" : ""}`}
              title="Alerts"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {mounted && alertUnreadCount > 0 && (
                <span className="absolute -top-1 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold text-white bg-[#ff4444] rounded-full px-0.5 leading-none">
                  {alertUnreadCount > 99 ? "99+" : alertUnreadCount}
                </span>
              )}
            </button>
          </div>
        )}

        <WalletButton onRefresh={onRefresh} loading={loading} lastSyncTime={lastSyncTime} onTrade={onTrade} onTradePosition={onTradePosition} />

        <button
          onClick={onOpenSettings}
          className="settings-btn"
          title="Settings"
          aria-label="Settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Alert Manager dropdown */}
      {alertManagerOpen && alertProps && onCloseAlertManager && (
        <AlertManager
          open={alertManagerOpen}
          onClose={onCloseAlertManager}
          onHoverEnter={() => {
            if (hoverTimeout.current) { clearTimeout(hoverTimeout.current); hoverTimeout.current = null; }
          }}
          onHoverLeave={() => {
            hoverTimeout.current = setTimeout(() => {
              onCloseAlertManager();
            }, 300);
          }}
          {...alertProps}
        />
      )}

      {/* Refresh progress bar */}
      {autoRefresh && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden">
          <div
            key={progressKey}
            className={loading ? "header-progress-pulse" : "header-progress-bar"}
          />
        </div>
      )}
    </header>
  );
}
