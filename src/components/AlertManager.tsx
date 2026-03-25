"use client";

import { useState, useCallback, useEffect } from "react";
import type { AlertConfig, AlertHistoryEntry, AlertType } from "@/hooks/useAlerts";
import type { ProcessedMarket, Category } from "@/types";
import type { SignalType } from "@/lib/smartSignals";
import { useI18n } from "@/i18n";

function formatTime(ts: number, t?: (key: string, vars?: Record<string, string | number>) => string) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t ? t("common.justNow") : "just now";
  if (mins < 60) return t ? t("trade.minAgo", { m: mins }) : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t ? t("trade.hAgo", { h: hours }) : `${hours}h ago`;
  return `${Math.floor(hours / 24)}d`;
}

const CATEGORIES: Category[] = [
  "Politics", "Crypto", "Sports",
  "Finance", "Tech", "Culture", "Other",
];

interface AlertManagerProps {
  open: boolean;
  onClose: () => void;
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
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
}

type Tab = "alerts" | "settings";

export default function AlertManager({
  prefill,
  ...props
}: AlertManagerProps) {
  const prefillKey = prefill?.marketId ?? "none";
  return <AlertManagerContent key={prefillKey} prefill={prefill} {...props} />;
}

function AlertManagerContent({
  open,
  onClose,
  alerts,
  history,
  onAddAlert,
  onRemoveAlert,
  onToggleAlert,
  onMarkRead,
  onMarkAllRead,
  onClearHistory,
  allMarkets,
  prefill,
  notifPermission,
  onRequestPermission,
  onHoverEnter,
  onHoverLeave,
}: AlertManagerProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<Tab>("alerts");

  // Create form state
  const [formType, setFormType] = useState<AlertType>("price_cross");
  const [formMarketSearch, setFormMarketSearch] = useState(prefill?.marketTitle || "");
  const [formMarketId, setFormMarketId] = useState(prefill?.marketId || "");
  const [formMarketTitle, setFormMarketTitle] = useState(prefill?.marketTitle || "");
  const [formThreshold, setFormThreshold] = useState("50");
  const [formDirection, setFormDirection] = useState<"above" | "below">("above");
  const [formCategory, setFormCategory] = useState<Category | "">("");
  const [formTag, setFormTag] = useState("");
  const [formSignalType, setFormSignalType] = useState<SignalType | "">("");
  const [formSignalStrength, setFormSignalStrength] = useState<"strong" | "moderate" | "weak">("moderate");
  const [formMinUsdcSize, setFormMinUsdcSize] = useState("5000");
  const [formHoursBeforeEnd, setFormHoursBeforeEnd] = useState("24");
  const [showForm, setShowForm] = useState(!!prefill);

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

  // Market search results
  const searchResults = formMarketSearch.length >= 2
    ? allMarkets
        .filter((m) => m.title.toLowerCase().includes(formMarketSearch.toLowerCase()))
        .slice(0, 5)
    : [];

  const handleSubmit = () => {
    if (formType === "price_cross") {
      if (!formMarketId || !formThreshold) return;
      onAddAlert({
        type: "price_cross",
        marketId: formMarketId,
        marketTitle: formMarketTitle,
        threshold: parseFloat(formThreshold),
        direction: formDirection,
      });
    } else if (formType === "smart_signal") {
      onAddAlert({
        type: "smart_signal",
        signalType: formSignalType || undefined,
        signalStrength: formSignalStrength,
      });
    } else if (formType === "whale_trade") {
      onAddAlert({
        type: "whale_trade",
        marketId: formMarketId || undefined,
        marketTitle: formMarketTitle || undefined,
        minUsdcSize: parseFloat(formMinUsdcSize) || 5000,
      });
    } else if (formType === "resolution_imminent") {
      onAddAlert({
        type: "resolution_imminent",
        marketId: formMarketId || undefined,
        marketTitle: formMarketTitle || undefined,
        category: formCategory || undefined,
        hoursBeforeEnd: parseFloat(formHoursBeforeEnd) || 24,
      });
    } else if (formType === "smart_divergence") {
      onAddAlert({
        type: "smart_divergence",
        marketId: formMarketId || undefined,
        marketTitle: formMarketTitle || undefined,
      });
    } else if (formType === "news_impact") {
      onAddAlert({
        type: "news_impact",
        marketId: formMarketId || undefined,
        marketTitle: formMarketTitle || undefined,
        tag: formTag || undefined,
      });
    } else {
      onAddAlert({
        type: "new_market",
        category: formCategory || undefined,
        tag: formTag || undefined,
      });
    }
    // Reset form
    setFormMarketSearch("");
    setFormMarketId("");
    setFormMarketTitle("");
    setFormThreshold("50");
    setFormDirection("above");
    setFormCategory("");
    setFormTag("");
    setFormSignalType("");
    setFormSignalStrength("moderate");
    setFormMinUsdcSize("5000");
    setFormHoursBeforeEnd("24");
    setShowForm(false);
  };

  const unreadCount = history.filter((h) => !h.read).length;

  return (
    <>
      {/* Light backdrop — only catches clicks, does not dim page; pointer-events disabled when hover-driven */}
      <div className={`alert-dropdown-backdrop ${onHoverLeave ? "pointer-events-none" : ""}`} onClick={onClose} />
      <div
        className="alert-dropdown"
        role="dialog"
        aria-modal="true"
        aria-label="Alert Manager"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
      >
        {/* Header */}
        <div className="alert-dropdown-header">
          <div className="alert-header-left">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="alert-header-icon">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="alert-dropdown-title">{t("alerts.title")}</span>
          </div>
          <button onClick={onClose} className="alert-dropdown-close" aria-label="Close">&times;</button>
        </div>

        {/* Tabs */}
        <div className="alert-dropdown-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === "alerts"}
            onClick={() => setActiveTab("alerts")}
            className={`alert-dropdown-tab${activeTab === "alerts" ? " active" : ""}`}
          >
            {t("alerts.alertsTab")}
            {unreadCount > 0 && (
              <span className="alert-tab-badge alert-tab-badge-unread">{unreadCount}</span>
            )}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "settings"}
            onClick={() => setActiveTab("settings")}
            className={`alert-dropdown-tab${activeTab === "settings" ? " active" : ""}`}
          >
            {t("alerts.settingsTab")}
            {alerts.length > 0 && (
              <span className="alert-tab-badge">{alerts.length}</span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="alert-dropdown-content">
          {/* Notification permission banner */}
          {notifPermission !== "granted" && (
            <div className="alert-notif-banner">
              <div className="alert-notif-banner-inner">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{t("alerts.browserNotifs", { status: notifPermission === "denied" ? "blocked by browser" : "not enabled" })}</span>
              </div>
              {notifPermission !== "denied" && (
                <button onClick={onRequestPermission} className="alert-notif-enable-btn">
                  {t("alerts.enable")}
                </button>
              )}
            </div>
          )}

          {activeTab === "settings" && (
            <div>
              {/* Alert list */}
              <div className="alert-section">
                <span className="section-label">{t("alerts.activeAlerts")}</span>
                {alerts.length === 0 ? (
                  <div className="alert-empty-state">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    <span>{t("alerts.noAlerts")}</span>
                  </div>
                ) : (
                  <div className="alert-list">
                    {alerts.map((alert) => (
                      <div key={alert.id} className="alert-item">
                        {/* Type icon */}
                        <div className={`alert-type-icon ${alert.type === "price_cross" || alert.type === "smart_signal" || alert.type === "smart_divergence" ? "alert-type-price" : "alert-type-new"}`}>
                          {alert.type === "price_cross" ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                            </svg>
                          ) : alert.type === "smart_signal" || alert.type === "smart_divergence" ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M2 12h4l3-9 6 18 3-9h4" />
                            </svg>
                          ) : alert.type === "whale_trade" ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                            </svg>
                          ) : alert.type === "resolution_imminent" ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10" />
                              <polyline points="12 6 12 12 16 14" />
                            </svg>
                          ) : alert.type === "news_impact" ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="16" />
                              <line x1="8" y1="12" x2="16" y2="12" />
                            </svg>
                          )}
                        </div>
                        {/* Description */}
                        <div className="alert-item-body">
                          {alert.type === "price_cross" ? (
                            <div className="alert-item-desc">
                              <span className="alert-item-market">{alert.marketTitle || alert.marketId}</span>
                              {" "}{t("alerts.crossesAboveBelow", { direction: alert.direction === "above" ? t("alerts.above") : t("alerts.below") })}{" "}
                              <span className={alert.direction === "above" ? "alert-val-green" : "alert-val-red"}>
                                {alert.threshold}%
                              </span>
                            </div>
                          ) : alert.type === "smart_signal" ? (
                            <div className="alert-item-desc">
                              {t("alerts.smartSignalDesc")}
                              {alert.signalType && <span className="alert-item-market"> ({alert.signalType.replace(/_/g, " ")})</span>}
                              {alert.signalStrength && <span className="alert-item-market"> {t("alerts.minLabel", { strength: alert.signalStrength })}</span>}
                            </div>
                          ) : alert.type === "whale_trade" ? (
                            <div className="alert-item-desc">
                              {t("alerts.whaleTradeDesc")}{alert.marketTitle ? <span className="alert-item-market"> {t("alerts.onMarketDesc", { market: alert.marketTitle })}</span> : ` ${t("alerts.anyMarketDesc")}`}
                              <span className="alert-item-market"> {t("alerts.minSizeDesc", { size: ((alert.minUsdcSize || 5000) / 1000).toFixed(0) })}</span>
                            </div>
                          ) : alert.type === "resolution_imminent" ? (
                            <div className="alert-item-desc">
                              {t("alerts.resolutionImminentDesc")}
                              {alert.marketTitle ? <span className="alert-item-market"> {t("alerts.dashMarket", { market: alert.marketTitle })}</span> : alert.category ? <span className="alert-item-market"> {t("alerts.dashCategory", { category: alert.category })}</span> : ` ${t("alerts.anyMarketDesc")}`}
                              <span className="alert-item-market"> {t("alerts.withinHoursDesc", { hours: alert.hoursBeforeEnd || 24 })}</span>
                            </div>
                          ) : alert.type === "smart_divergence" ? (
                            <div className="alert-item-desc">
                              {t("alerts.smartDivergenceDesc")}
                              {alert.marketTitle ? <span className="alert-item-market"> {t("alerts.onMarketDesc", { market: alert.marketTitle })}</span> : ` ${t("alerts.anyMarketDesc")}`}
                            </div>
                          ) : alert.type === "news_impact" ? (
                            <div className="alert-item-desc">
                              {t("alerts.newsImpactDesc")}
                              {alert.marketTitle ? <span className="alert-item-market"> {t("alerts.onMarketDesc", { market: alert.marketTitle })}</span> : alert.tag ? <span className="alert-item-market"> {t("alerts.matchingTagDesc", { tag: alert.tag })}</span> : ` ${t("alerts.anyDesc")}`}
                            </div>
                          ) : (
                            <div className="alert-item-desc">
                              {t("alerts.newMarketDesc")}
                              {alert.category && <span className="alert-item-market"> {t("alerts.inCategoryDesc", { category: alert.category })}</span>}
                              {alert.tag && <span className="alert-item-market"> {t("alerts.taggedWithDesc", { tag: alert.tag })}</span>}
                            </div>
                          )}
                          {alert.lastTriggered && (
                            <div className="alert-item-meta">
                              {t("alerts.lastTriggeredDesc", { time: formatTime(alert.lastTriggered, t) })}
                            </div>
                          )}
                        </div>
                        {/* Toggle */}
                        <button
                          onClick={() => onToggleAlert(alert.id)}
                          className={`alert-toggle-btn ${alert.enabled ? "alert-toggle-on" : ""}`}
                        >
                          {alert.enabled ? t("common.on") : t("common.off")}
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => onRemoveAlert(alert.id)}
                          className="alert-delete-btn"
                          title={t("alerts.deleteAlert")}
                        >
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M4 4l8 8M12 4l-8 8" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Create form */}
              <div className="alert-section">
                {!showForm ? (
                  <button onClick={() => setShowForm(true)} className="alert-create-trigger">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="8" y1="2" x2="8" y2="14" />
                      <line x1="2" y1="8" x2="14" y2="8" />
                    </svg>
                    {t("alerts.createAlertBtn")}
                  </button>
                ) : (
                  <div className="alert-form">
                    <div className="alert-form-header">
                      <span className="section-label" style={{ marginBottom: 0, marginTop: 0 }}>{t("alerts.createAlert")}</span>
                      <button onClick={() => setShowForm(false)} className="alert-form-cancel">{t("alerts.cancelCreate")}</button>
                    </div>

                    {/* Type selector */}
                    <div className="alert-type-selector">
                      <button
                        onClick={() => setFormType("price_cross")}
                        className={`alert-type-btn ${formType === "price_cross" ? "active" : ""}`}
                      >
                        {t("alerts.priceCross")}
                      </button>
                      <button
                        onClick={() => setFormType("new_market")}
                        className={`alert-type-btn ${formType === "new_market" ? "active" : ""}`}
                      >
                        {t("alerts.newMarket")}
                      </button>
                      <button
                        onClick={() => setFormType("smart_signal")}
                        className={`alert-type-btn ${formType === "smart_signal" ? "active" : ""}`}
                      >
                        {t("alerts.smartSignal")}
                      </button>
                      <button
                        onClick={() => setFormType("whale_trade")}
                        className={`alert-type-btn ${formType === "whale_trade" ? "active" : ""}`}
                      >
                        {t("alerts.whaleTrade")}
                      </button>
                      <button
                        onClick={() => setFormType("resolution_imminent")}
                        className={`alert-type-btn ${formType === "resolution_imminent" ? "active" : ""}`}
                      >
                        {t("alerts.resolution")}
                      </button>
                      <button
                        onClick={() => setFormType("smart_divergence")}
                        className={`alert-type-btn ${formType === "smart_divergence" ? "active" : ""}`}
                      >
                        {t("alerts.divergence")}
                      </button>
                      <button
                        onClick={() => setFormType("news_impact")}
                        className={`alert-type-btn ${formType === "news_impact" ? "active" : ""}`}
                      >
                        {t("alerts.newsImpact")}
                      </button>
                    </div>

                    {formType === "price_cross" && (
                      <div className="alert-form-fields">
                        {/* Market search */}
                        <div className="alert-field">
                          <label className="alert-field-label">{t("alerts.market")}</label>
                          <div className="alert-search-wrap">
                            <input
                              type="text"
                              value={formMarketSearch}
                              onChange={(e) => {
                                setFormMarketSearch(e.target.value);
                                setFormMarketId("");
                                setFormMarketTitle("");
                              }}
                              placeholder={t("alerts.searchMarkets")}
                              className="alert-input"
                            />
                            {searchResults.length > 0 && !formMarketId && (
                              <div className="alert-search-results">
                                {searchResults.map((m) => (
                                  <button
                                    key={m.id}
                                    onClick={() => {
                                      setFormMarketId(m.id);
                                      setFormMarketTitle(m.title);
                                      setFormMarketSearch(m.title);
                                    }}
                                    className="alert-search-item"
                                  >
                                    {m.title}
                                  </button>
                                ))}
                              </div>
                            )}
                            {formMarketId && (
                              <div className="alert-selected-market">
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 8 7 12 13 4" />
                                </svg>
                                {formMarketTitle}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Threshold + Direction */}
                        <div className="alert-field-row">
                          <div className="alert-field alert-field-half">
                            <label className="alert-field-label">{t("alerts.threshold")}</label>
                            <input
                              type="number"
                              value={formThreshold}
                              onChange={(e) => setFormThreshold(e.target.value)}
                              min="0"
                              max="100"
                              step="1"
                              className="alert-input"
                            />
                          </div>
                          <div className="alert-field alert-field-half">
                            <label className="alert-field-label">{t("alerts.direction")}</label>
                            <div className="alert-direction-btns">
                              <button
                                onClick={() => setFormDirection("above")}
                                className={`alert-dir-btn ${formDirection === "above" ? "alert-dir-above" : ""}`}
                              >
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M8 12V4M4 7l4-4 4 4" />
                                </svg>
                                {t("alerts.above")}
                              </button>
                              <button
                                onClick={() => setFormDirection("below")}
                                className={`alert-dir-btn ${formDirection === "below" ? "alert-dir-below" : ""}`}
                              >
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M8 4v8M4 9l4 4 4-4" />
                                </svg>
                                {t("alerts.below")}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {formType === "new_market" && (
                      <div className="alert-form-fields">
                        <div className="alert-field">
                          <label className="alert-field-label">{t("alerts.categoryOptional")}</label>
                          <div className="alert-category-grid">
                            <button
                              onClick={() => setFormCategory("")}
                              className={`alert-cat-btn ${!formCategory ? "active" : ""}`}
                            >
                              {t("alerts.any")}
                            </button>
                            {CATEGORIES.map((cat) => (
                              <button
                                key={cat}
                                onClick={() => setFormCategory(cat)}
                                className={`alert-cat-btn ${formCategory === cat ? "active" : ""}`}
                              >
                                {cat}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="alert-field">
                          <label className="alert-field-label">{t("alerts.tagFilter")}</label>
                          <input
                            type="text"
                            value={formTag}
                            onChange={(e) => setFormTag(e.target.value)}
                            placeholder="e.g. bitcoin, election"
                            className="alert-input"
                          />
                        </div>
                      </div>
                    )}

                    {formType === "smart_signal" && (
                      <div className="alert-form-fields">
                        <div className="alert-field">
                          <label className="alert-field-label">{t("alerts.signalType")}</label>
                          <div className="alert-category-grid">
                            <button
                              onClick={() => setFormSignalType("")}
                              className={`alert-cat-btn ${!formSignalType ? "active" : ""}`}
                            >
                              {t("alerts.any")}
                            </button>
                            {(["whale_accumulation", "smart_divergence", "cluster_activity", "momentum_shift"] as SignalType[]).map((st) => (
                              <button
                                key={st}
                                onClick={() => setFormSignalType(st)}
                                className={`alert-cat-btn ${formSignalType === st ? "active" : ""}`}
                              >
                                {st.replace(/_/g, " ")}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="alert-field">
                          <label className="alert-field-label">{t("alerts.minStrength")}</label>
                          <div className="alert-direction-btns">
                            {(["weak", "moderate", "strong"] as const).map((s) => (
                              <button
                                key={s}
                                onClick={() => setFormSignalStrength(s)}
                                className={`alert-dir-btn ${formSignalStrength === s ? "alert-dir-above" : ""}`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {formType === "whale_trade" && (
                      <div className="alert-form-fields">
                        <div className="alert-field">
                          <label className="alert-field-label">{t("alerts.marketOptionalAny")}</label>
                          <div className="alert-search-wrap">
                            <input
                              type="text"
                              value={formMarketSearch}
                              onChange={(e) => {
                                setFormMarketSearch(e.target.value);
                                setFormMarketId("");
                                setFormMarketTitle("");
                              }}
                              placeholder={t("alerts.searchMarkets")}
                              className="alert-input"
                            />
                            {searchResults.length > 0 && !formMarketId && (
                              <div className="alert-search-results">
                                {searchResults.map((m) => (
                                  <button
                                    key={m.id}
                                    onClick={() => {
                                      setFormMarketId(m.id);
                                      setFormMarketTitle(m.title);
                                      setFormMarketSearch(m.title);
                                    }}
                                    className="alert-search-item"
                                  >
                                    {m.title}
                                  </button>
                                ))}
                              </div>
                            )}
                            {formMarketId && (
                              <div className="alert-selected-market">
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 8 7 12 13 4" />
                                </svg>
                                {formMarketTitle}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="alert-field">
                          <label className="alert-field-label">{t("alerts.minTradeSize")}</label>
                          <input
                            type="number"
                            value={formMinUsdcSize}
                            onChange={(e) => setFormMinUsdcSize(e.target.value)}
                            min="1000"
                            step="1000"
                            className="alert-input"
                          />
                        </div>
                      </div>
                    )}

                    {formType === "resolution_imminent" && (
                      <div className="alert-form-fields">
                        <div className="alert-field">
                          <label className="alert-field-label">{t("alerts.marketOptional")}</label>
                          <div className="alert-search-wrap">
                            <input
                              type="text"
                              value={formMarketSearch}
                              onChange={(e) => {
                                setFormMarketSearch(e.target.value);
                                setFormMarketId("");
                                setFormMarketTitle("");
                              }}
                              placeholder={t("alerts.searchMarkets")}
                              className="alert-input"
                            />
                            {searchResults.length > 0 && !formMarketId && (
                              <div className="alert-search-results">
                                {searchResults.map((m) => (
                                  <button
                                    key={m.id}
                                    onClick={() => {
                                      setFormMarketId(m.id);
                                      setFormMarketTitle(m.title);
                                      setFormMarketSearch(m.title);
                                    }}
                                    className="alert-search-item"
                                  >
                                    {m.title}
                                  </button>
                                ))}
                              </div>
                            )}
                            {formMarketId && (
                              <div className="alert-selected-market">
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 8 7 12 13 4" />
                                </svg>
                                {formMarketTitle}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="alert-field-row">
                          <div className="alert-field alert-field-half">
                            <label className="alert-field-label">{t("alerts.hoursBeforeEnd")}</label>
                            <input
                              type="number"
                              value={formHoursBeforeEnd}
                              onChange={(e) => setFormHoursBeforeEnd(e.target.value)}
                              min="1"
                              max="168"
                              step="1"
                              className="alert-input"
                            />
                          </div>
                          <div className="alert-field alert-field-half">
                            <label className="alert-field-label">{t("alerts.categoryOptional")}</label>
                            <div className="alert-category-grid">
                              <button
                                onClick={() => setFormCategory("")}
                                className={`alert-cat-btn ${!formCategory ? "active" : ""}`}
                              >
                                {t("alerts.any")}
                              </button>
                              {CATEGORIES.map((cat) => (
                                <button
                                  key={cat}
                                  onClick={() => setFormCategory(cat)}
                                  className={`alert-cat-btn ${formCategory === cat ? "active" : ""}`}
                                >
                                  {cat}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {formType === "smart_divergence" && (
                      <div className="alert-form-fields">
                        <div className="alert-field">
                          <label className="alert-field-label">{t("alerts.marketOptionalAny")}</label>
                          <div className="alert-search-wrap">
                            <input
                              type="text"
                              value={formMarketSearch}
                              onChange={(e) => {
                                setFormMarketSearch(e.target.value);
                                setFormMarketId("");
                                setFormMarketTitle("");
                              }}
                              placeholder={t("alerts.searchMarkets")}
                              className="alert-input"
                            />
                            {searchResults.length > 0 && !formMarketId && (
                              <div className="alert-search-results">
                                {searchResults.map((m) => (
                                  <button
                                    key={m.id}
                                    onClick={() => {
                                      setFormMarketId(m.id);
                                      setFormMarketTitle(m.title);
                                      setFormMarketSearch(m.title);
                                    }}
                                    className="alert-search-item"
                                  >
                                    {m.title}
                                  </button>
                                ))}
                              </div>
                            )}
                            {formMarketId && (
                              <div className="alert-selected-market">
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 8 7 12 13 4" />
                                </svg>
                                {formMarketTitle}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="alert-field">
                          <span className="alert-field-label" style={{ color: "var(--text-dim)" }}>
                            {t("alerts.divergenceDesc")}
                          </span>
                        </div>
                      </div>
                    )}

                    {formType === "news_impact" && (
                      <div className="alert-form-fields">
                        <div className="alert-field">
                          <label className="alert-field-label">{t("alerts.marketOptional")}</label>
                          <div className="alert-search-wrap">
                            <input
                              type="text"
                              value={formMarketSearch}
                              onChange={(e) => {
                                setFormMarketSearch(e.target.value);
                                setFormMarketId("");
                                setFormMarketTitle("");
                              }}
                              placeholder={t("alerts.searchMarkets")}
                              className="alert-input"
                            />
                            {searchResults.length > 0 && !formMarketId && (
                              <div className="alert-search-results">
                                {searchResults.map((m) => (
                                  <button
                                    key={m.id}
                                    onClick={() => {
                                      setFormMarketId(m.id);
                                      setFormMarketTitle(m.title);
                                      setFormMarketSearch(m.title);
                                    }}
                                    className="alert-search-item"
                                  >
                                    {m.title}
                                  </button>
                                ))}
                              </div>
                            )}
                            {formMarketId && (
                              <div className="alert-selected-market">
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 8 7 12 13 4" />
                                </svg>
                                {formMarketTitle}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="alert-field">
                          <label className="alert-field-label">{t("alerts.keywordOptional")}</label>
                          <input
                            type="text"
                            value={formTag}
                            onChange={(e) => setFormTag(e.target.value)}
                            placeholder="e.g. bitcoin, trump, fed"
                            className="alert-input"
                          />
                        </div>
                      </div>
                    )}

                    {/* Submit */}
                    <button
                      onClick={handleSubmit}
                      disabled={formType === "price_cross" && (!formMarketId || !formThreshold)}
                      className="alert-submit-btn"
                    >
                      {t("alerts.createAlertBtn")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "alerts" && (
            <div>
              <div className="alert-section">
                <div className="alert-history-header">
                  <span className="section-label" style={{ marginBottom: 0, marginTop: 0 }}>{t("alerts.triggerHistory")}</span>
                  <div className="alert-history-actions">
                    {history.some((h) => !h.read) && (
                      <button onClick={onMarkAllRead} className="alert-history-action">
                        {t("alerts.markAllRead")}
                      </button>
                    )}
                    {history.length > 0 && (
                      <button onClick={onClearHistory} className="alert-history-action alert-history-action-danger">
                        {t("alerts.clearHistory")}
                      </button>
                    )}
                  </div>
                </div>

                {history.length === 0 ? (
                  <div className="alert-empty-state">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span>{t("alerts.noTriggersYet")}</span>
                  </div>
                ) : (
                  <div className="alert-history-list">
                    {history.map((entry) => (
                      <button
                        key={entry.id}
                        onClick={() => onMarkRead(entry.id)}
                        className={`alert-history-item ${entry.read ? "read" : "unread"}`}
                      >
                        <div className="alert-history-item-inner">
                          {!entry.read && <span className="alert-unread-dot" />}
                          <div className="alert-history-item-body">
                            <div className="alert-history-msg">{entry.message}</div>
                            <div className="alert-history-time">{formatTime(entry.timestamp, t)}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
