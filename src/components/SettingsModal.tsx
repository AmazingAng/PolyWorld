"use client";

import { useEffect, useState, useCallback } from "react";
import { Category } from "@/types";
import { CATEGORY_COLORS } from "@/lib/categories";
import { STREAMS } from "@/lib/streams";
import type { TimeRange } from "./TimeRangeFilter";
import { useI18n, type Locale } from "@/i18n";

export interface PanelVisibility {
  markets: boolean;
  detail: boolean;
  country: boolean;
  news: boolean;
  live: boolean;
  watchlist: boolean;
  leaderboard: boolean;
  smartMoney: boolean;
  whaleTrades: boolean;
  orderbook: boolean;
  sentiment: boolean;
  tweets: boolean;
  trader: boolean;
  chart: boolean;
  arbitrage: boolean;
  calendar: boolean;
  signals: boolean;
  resolution: boolean;
  portfolio: boolean;
  openOrders: boolean;
  alertHistory: boolean;
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
  showToasts: boolean;
  onToggleShowToasts: () => void;
  panelVisibility: PanelVisibility;
  onTogglePanelVisibility: (panel: string) => void;
  dataMode: "live" | "sample";
  lastSyncTime: string | null;
  marketCount: number;
  globalCount: number;
}

const CATEGORIES: Category[] = [
  "Politics", "Crypto", "Sports",
  "Finance", "Tech", "Culture", "Other",
];

const TIME_OPTIONS: TimeRange[] = ["1h", "6h", "24h", "48h", "7d", "ALL"];

type Tab = "general" | "panels" | "sources" | "system";

const TAB_KEYS: Tab[] = ["general", "panels", "sources", "system"];

const PANEL_KEYS: string[] = [
  "watchlist", "markets", "country", "news", "live",
  "leaderboard", "smartMoney", "whaleTrades", "orderbook",
  "sentiment", "tweets", "trader", "chart", "arbitrage",
  "calendar", "signals", "resolution", "portfolio", "openOrders",
];

const PANEL_I18N_MAP: Record<string, string> = {
  watchlist: "panels.watchlist",
  markets: "panels.markets",
  country: "panels.country",
  news: "panels.newsFeed",
  live: "panels.live",
  leaderboard: "panels.leaderboard",
  smartMoney: "panels.smartTrades",
  whaleTrades: "panels.whaleTrades",
  orderbook: "panels.orderbook",
  sentiment: "panels.sentiment",
  tweets: "panels.tweets",
  trader: "panels.trader",
  chart: "panels.chart",
  arbitrage: "panels.arbitrage",
  calendar: "panels.calendar",
  signals: "panels.signals",
  resolution: "panels.resolution",
  portfolio: "panels.portfolio",
  openOrders: "panels.openOrders",
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
  showToasts,
  onToggleShowToasts,
  panelVisibility,
  onTogglePanelVisibility,
  dataMode,
  lastSyncTime,
  marketCount,
  globalCount,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const { t } = useI18n();

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

  const TAB_LABELS: Record<Tab, string> = {
    general: t("settings.general"),
    panels: t("settings.panels"),
    sources: t("settings.sources"),
    system: t("settings.system"),
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="settings-header">
          <span className="settings-title">{t("settings.title")}</span>
          <button onClick={onClose} className="settings-close" aria-label={t("settings.closeSettings")}>&times;</button>
        </div>

        {/* Horizontal tabs */}
        <div className="settings-tabs" role="tablist">
          {TAB_KEYS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              onClick={() => setActiveTab(key)}
              className={`settings-tab${activeTab === key ? " active" : ""}`}
            >
              {TAB_LABELS[key]}
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
              showToasts={showToasts}
              onToggleShowToasts={onToggleShowToasts}
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
  showToasts,
  onToggleShowToasts,
}: {
  activeCategories: Set<Category>;
  onToggleCategory: (cat: Category) => void;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  showToasts: boolean;
  onToggleShowToasts: () => void;
}) {
  const { t, locale, setLocale } = useI18n();
  return (
    <div>
      {/* Categories */}
      <div className="settings-section">
        <span className="section-label">{t("settings.categories")}</span>
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
                <span className="panel-toggle-label">{t(`categories.${cat}`)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Time Range */}
      <div className="settings-section">
        <span className="section-label">{t("settings.timeRange")}</span>
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

      {/* Language */}
      <div className="settings-section">
        <span className="section-label">{t("settings.language")}</span>
        <div className="settings-pill-bar">
          {(["en", "zh"] as Locale[]).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={`settings-pill${locale === l ? " active" : ""}`}
            >
              {l === "en" ? "English" : "中文"}
            </button>
          ))}
        </div>
      </div>

      {/* Auto-refresh */}
      <div className="settings-section">
        <span className="section-label">{t("settings.autoRefresh")}</span>
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
            {autoRefresh ? t("settings.autoRefreshOn") : t("common.off")}
          </span>
        </button>
      </div>

      {/* Show Toasts */}
      <div className="settings-section">
        <span className="section-label">{t("settings.showToasts")}</span>
        <button
          type="button"
          className={`panel-toggle-item${showToasts ? " active" : ""}`}
          onClick={onToggleShowToasts}
          style={{ width: "fit-content" }}
        >
          <span
            className="panel-toggle-checkbox"
            style={{
              background: showToasts ? "var(--green)" : "transparent",
              borderColor: showToasts ? "var(--green)" : "var(--border)",
              color: showToasts ? "var(--bg)" : "transparent",
            }}
          >
            {showToasts && "\u2713"}
          </span>
          <span className="panel-toggle-label">
            {showToasts ? t("common.on") : t("common.off")}
          </span>
        </button>
      </div>

      {/* Theme */}
      <div className="settings-section">
        <span className="section-label">{t("settings.theme")}</span>
        <div className="settings-info-value">{t("settings.themeDark")}</div>
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
  const { t } = useI18n();
  return (
    <div>
      <div className="settings-section">
        <span className="section-label">{t("settings.panelVisibility")}</span>
        <div className="settings-grid-2col">
          {PANEL_KEYS.map((key) => {
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
                <span className="panel-toggle-label">{t(PANEL_I18N_MAP[key])}</span>
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
  dataMode: "live" | "sample";
  lastSyncTime: string | null;
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className="settings-section">
        <span className="section-label">{t("settings.dataSource")}</span>
        <div className="settings-info-grid">
          <InfoRow label={t("settings.provider")} value="Polymarket Gamma API" />
          <InfoRow label={t("settings.endpoint")} value="/api/markets" />
          <InfoRow
            label={t("settings.dataMode")}
            value={dataMode}
            color={dataMode === "live" ? "var(--green)" : "var(--yellow)"}
          />
          <InfoRow
            label={t("settings.lastSync")}
            value={lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString("en-US") : "—"}
          />
          <InfoRow label={t("settings.refreshInterval")} value="45s" />
          <InfoRow label={t("settings.hlsStreams")} value={String(STREAMS.length)} />
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
  dataMode: "live" | "sample";
  lastSyncTime: string | null;
  marketCount: number;
  globalCount: number;
  autoRefresh: boolean;
  activeCategories: Set<Category>;
  timeRange: TimeRange;
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className="settings-section">
        <span className="section-label">{t("settings.systemStatus")}</span>
        <div className="settings-info-grid">
          <InfoRow
            label={t("settings.dataMode")}
            value={dataMode}
            color={dataMode === "live" ? "var(--green)" : "var(--yellow)"}
          />
          <InfoRow
            label={t("settings.syncStatus")}
            value={lastSyncTime ? t("settings.synced") : t("settings.pending")}
            color={lastSyncTime ? "var(--green)" : "var(--yellow)"}
          />
          <InfoRow label={t("settings.mappedMarkets")} value={String(marketCount)} />
          <InfoRow label={t("settings.globalMarkets")} value={String(globalCount)} />
          <InfoRow label={t("settings.totalMarkets")} value={String(marketCount + globalCount)} />
          <InfoRow
            label={t("settings.autoRefresh")}
            value={autoRefresh ? t("settings.autoRefreshOn") : t("common.off")}
            color={autoRefresh ? "var(--green)" : "var(--text-faint)"}
          />
          <InfoRow
            label={t("settings.activeCategories")}
            value={`${activeCategories.size} / ${CATEGORIES.length}`}
          />
          <InfoRow label={t("settings.timeRange")} value={timeRange} />
          <InfoRow label={t("settings.version")} value="0.1.0" />
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
