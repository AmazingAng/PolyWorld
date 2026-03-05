"use client";

import { useEffect, useState, useCallback } from "react";
import { Category } from "@/types";
import { CATEGORY_COLORS } from "@/lib/categories";
import { STREAMS } from "@/lib/streams";
import type { TimeRange } from "./TimeRangeFilter";

export interface PanelVisibility {
  markets: boolean;
  detail: boolean;
  country: boolean;
  news: boolean;
  live: boolean;
  watchlist: boolean;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  activeCategories: Set<Category>;
  onToggleCategory: (cat: Category) => void;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  panelVisibility: PanelVisibility;
  onTogglePanelVisibility: (panel: string) => void;
  dataMode: "live" | "proxy" | "sample";
  lastSyncTime: string | null;
  marketCount: number;
  globalCount: number;
}

const CATEGORIES: Category[] = [
  "Politics", "Geopolitics", "Crypto", "Sports",
  "Finance", "Tech", "Culture", "Other",
];

const TIME_OPTIONS: TimeRange[] = ["1h", "6h", "24h", "48h", "7d", "ALL"];

type Tab = "general" | "panels" | "sources" | "system";

const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "GENERAL" },
  { key: "panels", label: "PANELS" },
  { key: "sources", label: "SOURCES" },
  { key: "system", label: "STATUS" },
];

const PANEL_LABELS: Record<string, string> = {
  watchlist: "Watchlist",
  markets: "Markets",
  detail: "Market Detail",
  country: "Country",
  news: "News Feed",
  live: "Live Streams",
};

export default function SettingsModal({
  open,
  onClose,
  activeCategories,
  onToggleCategory,
  timeRange,
  onTimeRangeChange,
  autoRefresh,
  onToggleAutoRefresh,
  panelVisibility,
  onTogglePanelVisibility,
  dataMode,
  lastSyncTime,
  marketCount,
  globalCount,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("general");

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button onClick={onClose} className="settings-close" aria-label="Close settings">&times;</button>
        </div>

        {/* Horizontal tabs — WorldMonitor unified-settings-tabs style */}
        <div className="settings-tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`settings-tab${activeTab === tab.key ? " active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="settings-content">
          {activeTab === "general" && (
            <GeneralTab
              activeCategories={activeCategories}
              onToggleCategory={onToggleCategory}
              timeRange={timeRange}
              onTimeRangeChange={onTimeRangeChange}
              autoRefresh={autoRefresh}
              onToggleAutoRefresh={onToggleAutoRefresh}
            />
          )}
          {activeTab === "panels" && (
            <PanelsTab
              panelVisibility={panelVisibility}
              onTogglePanelVisibility={onTogglePanelVisibility}
            />
          )}
          {activeTab === "sources" && (
            <SourcesTab dataMode={dataMode} lastSyncTime={lastSyncTime} />
          )}
          {activeTab === "system" && (
            <SystemTab
              dataMode={dataMode}
              lastSyncTime={lastSyncTime}
              marketCount={marketCount}
              globalCount={globalCount}
              autoRefresh={autoRefresh}
              activeCategories={activeCategories}
              timeRange={timeRange}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Tab: GENERAL ─── */
function GeneralTab({
  activeCategories,
  onToggleCategory,
  timeRange,
  onTimeRangeChange,
  autoRefresh,
  onToggleAutoRefresh,
}: {
  activeCategories: Set<Category>;
  onToggleCategory: (cat: Category) => void;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
}) {
  return (
    <div>
      {/* Categories */}
      <div className="settings-section">
        <span className="section-label">CATEGORIES</span>
        <div className="settings-grid-2col">
          {CATEGORIES.map((cat) => {
            const active = activeCategories.has(cat);
            return (
              <button
                key={cat}
                type="button"
                className={`panel-toggle-item${active ? " active" : ""}`}
                onClick={() => onToggleCategory(cat)}
              >
                <span
                  className="panel-toggle-checkbox"
                  style={{
                    background: active ? CATEGORY_COLORS[cat] : "transparent",
                    borderColor: active ? CATEGORY_COLORS[cat] : "var(--border)",
                    color: active ? "var(--bg)" : "transparent",
                  }}
                >
                  {active && "\u2713"}
                </span>
                <span className="panel-toggle-label">{cat}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Time Range */}
      <div className="settings-section">
        <span className="section-label">TIME RANGE</span>
        <div className="settings-pill-bar">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => onTimeRangeChange(opt)}
              className={`settings-pill${timeRange === opt ? " active" : ""}`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Auto-refresh */}
      <div className="settings-section">
        <span className="section-label">AUTO-REFRESH</span>
        <button
          type="button"
          className={`panel-toggle-item${autoRefresh ? " active" : ""}`}
          onClick={onToggleAutoRefresh}
          style={{ width: "fit-content" }}
        >
          <span
            className="panel-toggle-checkbox"
            style={{
              background: autoRefresh ? "var(--green)" : "transparent",
              borderColor: autoRefresh ? "var(--green)" : "var(--border)",
              color: autoRefresh ? "var(--bg)" : "transparent",
            }}
          >
            {autoRefresh && "\u2713"}
          </span>
          <span className="panel-toggle-label">
            {autoRefresh ? "ON (45s)" : "OFF"}
          </span>
        </button>
      </div>

      {/* Theme */}
      <div className="settings-section">
        <span className="section-label">THEME</span>
        <div className="settings-info-value">dark (default)</div>
      </div>
    </div>
  );
}

/* ─── Tab: PANELS ─── */
function PanelsTab({
  panelVisibility,
  onTogglePanelVisibility,
}: {
  panelVisibility: PanelVisibility;
  onTogglePanelVisibility: (panel: string) => void;
}) {
  return (
    <div>
      <div className="settings-section">
        <span className="section-label">PANEL VISIBILITY</span>
        <div className="settings-grid-2col">
          {Object.entries(PANEL_LABELS).map(([key, label]) => {
            const visible = panelVisibility[key as keyof PanelVisibility];
            return (
              <button
                key={key}
                type="button"
                className={`panel-toggle-item${visible ? " active" : ""}`}
                onClick={() => onTogglePanelVisibility(key)}
              >
                <span
                  className="panel-toggle-checkbox"
                  style={{
                    background: visible ? "var(--green)" : "transparent",
                    borderColor: visible ? "var(--green)" : "var(--border)",
                    color: visible ? "var(--bg)" : "transparent",
                  }}
                >
                  {visible && "\u2713"}
                </span>
                <span className="panel-toggle-label">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── Tab: SOURCES ─── */
function SourcesTab({
  dataMode,
  lastSyncTime,
}: {
  dataMode: "live" | "proxy" | "sample";
  lastSyncTime: string | null;
}) {
  return (
    <div>
      <div className="settings-section">
        <span className="section-label">DATA SOURCE</span>
        <div className="settings-info-grid">
          <InfoRow label="Provider" value="Polymarket Gamma API" />
          <InfoRow label="Endpoint" value="/api/markets" />
          <InfoRow
            label="Data mode"
            value={dataMode}
            color={dataMode === "live" ? "var(--green)" : "var(--yellow)"}
          />
          <InfoRow
            label="Last sync"
            value={lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString() : "—"}
          />
          <InfoRow label="Refresh interval" value="45s" />
          <InfoRow label="HLS streams" value={String(STREAMS.length)} />
        </div>
      </div>
    </div>
  );
}

/* ─── Tab: SYSTEM STATUS ─── */
function SystemTab({
  dataMode,
  lastSyncTime,
  marketCount,
  globalCount,
  autoRefresh,
  activeCategories,
  timeRange,
}: {
  dataMode: "live" | "proxy" | "sample";
  lastSyncTime: string | null;
  marketCount: number;
  globalCount: number;
  autoRefresh: boolean;
  activeCategories: Set<Category>;
  timeRange: TimeRange;
}) {
  return (
    <div>
      <div className="settings-section">
        <span className="section-label">SYSTEM STATUS</span>
        <div className="settings-info-grid">
          <InfoRow
            label="Data mode"
            value={dataMode}
            color={dataMode === "live" ? "var(--green)" : "var(--yellow)"}
          />
          <InfoRow
            label="Sync status"
            value={lastSyncTime ? "synced" : "pending"}
            color={lastSyncTime ? "var(--green)" : "var(--yellow)"}
          />
          <InfoRow label="Mapped markets" value={String(marketCount)} />
          <InfoRow label="Global markets" value={String(globalCount)} />
          <InfoRow label="Total markets" value={String(marketCount + globalCount)} />
          <InfoRow
            label="Auto-refresh"
            value={autoRefresh ? "on (45s)" : "off"}
            color={autoRefresh ? "var(--green)" : "var(--text-faint)"}
          />
          <InfoRow
            label="Active categories"
            value={`${activeCategories.size} / ${CATEGORIES.length}`}
          />
          <InfoRow label="Time range" value={timeRange} />
          <InfoRow label="Version" value="0.1.0" />
        </div>
      </div>
    </div>
  );
}

/* ─── Shared info row ─── */
function InfoRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="settings-info-row">
      <span className="settings-info-label">{label}</span>
      <span className="settings-info-value" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}
