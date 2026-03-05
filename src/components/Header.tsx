"use client";

import { useState, useEffect, useRef } from "react";
import AlertManager from "./AlertManager";
import type { AlertConfig, AlertHistoryEntry } from "@/hooks/useAlerts";
import type { ProcessedMarket } from "@/types";

interface HeaderProps {
  lastRefresh: string | null;
  dataMode: "live" | "proxy" | "sample";
  loading: boolean;
  onRefresh: () => void;
  marketCount: number;
  globalCount: number;
  lastSyncTime?: string | null;
  onOpenSettings: () => void;
  watchedCount?: number;
  alertUnreadCount?: number;
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
  lastRefresh,
  dataMode,
  loading,
  onRefresh,
  marketCount,
  globalCount,
  lastSyncTime,
  onOpenSettings,
  watchedCount = 0,
  alertUnreadCount = 0,
  alertManagerOpen,
  onOpenAlertManager,
  onCloseAlertManager,
  alertProps,
}: HeaderProps) {
  const syncInfo = lastSyncTime ? getRelativeTime(lastSyncTime) : null;
  const bellRef = useRef<HTMLButtonElement>(null);

  return (
    <header className="h-[36px] bg-[var(--bg)] border-b border-[var(--border-subtle)] flex items-center pl-4 pr-3 z-50 shrink-0 font-mono relative">
      {/* Left: Logo + subtitle + stats */}
      <div className="flex items-center gap-2">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--status-live)] shrink-0" aria-hidden="true">
          <polygon points="22,12 17,3.4 7,3.4 2,12 7,20.6 17,20.6" />
          <path d="M2 12h20M12 3.4L16 12l-4 8.6M12 3.4L8 12l4 8.6" />
        </svg>

        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-[var(--text)] tracking-tight whitespace-nowrap font-bold">
            PolyWorld
          </span>
          <span className="text-[10px] text-[var(--text-faint)] uppercase tracking-widest hidden md:inline">
            global situation
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

      {/* Right: Watchlist + Alerts + Status pill + sync info + refresh */}
      <div className="flex items-center gap-1.5 text-[11px]">
        {/* Watchlist count */}
        {watchedCount > 0 && (
          <span className="flex items-center gap-1 text-[#f59e0b] text-[11px]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" strokeWidth="1.5">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
            </svg>
            {watchedCount}
          </span>
        )}

        {/* Alert bell + dropdown */}
        {onOpenAlertManager && (
          <div className="relative">
            <button
              ref={bellRef}
              onClick={onOpenAlertManager}
              className={`relative text-[var(--text-muted)] hover:text-[var(--text)] transition-colors px-1 ${alertManagerOpen ? "text-[var(--text)]" : ""}`}
              title="Alerts"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {alertUnreadCount > 0 && (
                <span className="absolute -top-1 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold text-white bg-[#ff4444] rounded-full px-0.5 leading-none">
                  {alertUnreadCount > 99 ? "99+" : alertUnreadCount}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Status pill */}
        <span
          className={`flex items-center gap-1 px-1.5 py-px border text-[11px] uppercase tracking-wide ${
            dataMode === "live"
              ? "border-[#22c55e]/30 text-[#22c55e]"
              : dataMode === "sample"
              ? "border-[#ffaa00]/30 text-[#ffaa00]"
              : "border-[#79c0ff]/30 text-[#79c0ff]"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              loading
                ? "bg-[#ffaa00] animate-pulse"
                : dataMode === "live"
                ? "bg-[#22c55e]"
                : "bg-[#ffaa00]"
            }`}
          />
          {dataMode}
        </span>

        {/* Sync time / stale warning */}
        {syncInfo ? (
          <span
            className={`hidden sm:inline text-[11px] ${
              syncInfo.stale ? "text-[#ffaa00]" : "text-[var(--text-faint)]"
            }`}
            title={`Last sync: ${lastSyncTime}`}
          >
            {syncInfo.stale && "\u26A0 "}synced {syncInfo.text}
          </span>
        ) : (
          <span className="hidden sm:inline text-[var(--text-faint)] text-[11px]">
            {lastRefresh || "\u2026"}
          </span>
        )}

        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-[var(--text-muted)] px-1.5 py-px text-[11px] border border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-40"
        >
          refresh
        </button>

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
          {...alertProps}
        />
      )}
    </header>
  );
}
