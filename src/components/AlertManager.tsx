"use client";

import { useState, useCallback, useEffect } from "react";
import type { AlertConfig, AlertHistoryEntry } from "@/hooks/useAlerts";
import type { ProcessedMarket, Category } from "@/types";

const CATEGORIES: Category[] = [
  "Politics", "Geopolitics", "Crypto", "Sports",
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
}

type Tab = "alerts" | "history";
type AlertType = "price_cross" | "new_market";

export default function AlertManager({
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
}: AlertManagerProps) {
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
  const [showForm, setShowForm] = useState(!!prefill);

  // Update when prefill changes
  useEffect(() => {
    if (prefill?.marketId) {
      setFormType("price_cross");
      setFormMarketSearch(prefill.marketTitle || "");
      setFormMarketId(prefill.marketId);
      setFormMarketTitle(prefill.marketTitle || "");
      setShowForm(true);
      setActiveTab("alerts");
    }
  }, [prefill]);

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
    setShowForm(false);
  };

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const unreadCount = history.filter((h) => !h.read).length;

  return (
    <>
      {/* Light backdrop — only catches clicks, does not dim page */}
      <div className="alert-dropdown-backdrop" onClick={onClose} />
      <div
        className="alert-dropdown"
        role="dialog"
        aria-modal="true"
        aria-label="Alert Manager"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="alert-dropdown-header">
          <div className="alert-header-left">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="alert-header-icon">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="alert-dropdown-title">Alerts</span>
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
            ALERTS
            {alerts.length > 0 && (
              <span className="alert-tab-badge">{alerts.length}</span>
            )}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "history"}
            onClick={() => setActiveTab("history")}
            className={`alert-dropdown-tab${activeTab === "history" ? " active" : ""}`}
          >
            HISTORY
            {unreadCount > 0 && (
              <span className="alert-tab-badge alert-tab-badge-unread">{unreadCount}</span>
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
                <span>Browser notifications {notifPermission === "denied" ? "blocked by browser" : "not enabled"}</span>
              </div>
              {notifPermission !== "denied" && (
                <button onClick={onRequestPermission} className="alert-notif-enable-btn">
                  Enable
                </button>
              )}
            </div>
          )}

          {activeTab === "alerts" && (
            <div>
              {/* Alert list */}
              <div className="alert-section">
                <span className="section-label">ACTIVE ALERTS</span>
                {alerts.length === 0 ? (
                  <div className="alert-empty-state">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    <span>no alerts configured</span>
                  </div>
                ) : (
                  <div className="alert-list">
                    {alerts.map((alert) => (
                      <div key={alert.id} className="alert-item">
                        {/* Type icon */}
                        <div className={`alert-type-icon ${alert.type === "price_cross" ? "alert-type-price" : "alert-type-new"}`}>
                          {alert.type === "price_cross" ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
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
                              {" "}crosses {alert.direction}{" "}
                              <span className={alert.direction === "above" ? "alert-val-green" : "alert-val-red"}>
                                {alert.threshold}%
                              </span>
                            </div>
                          ) : (
                            <div className="alert-item-desc">
                              New market
                              {alert.category && <span className="alert-item-market"> in {alert.category}</span>}
                              {alert.tag && <span className="alert-item-market"> tagged &quot;{alert.tag}&quot;</span>}
                            </div>
                          )}
                          {alert.lastTriggered && (
                            <div className="alert-item-meta">
                              last triggered {formatTime(alert.lastTriggered)}
                            </div>
                          )}
                        </div>
                        {/* Toggle */}
                        <button
                          onClick={() => onToggleAlert(alert.id)}
                          className={`alert-toggle-btn ${alert.enabled ? "alert-toggle-on" : ""}`}
                        >
                          {alert.enabled ? "ON" : "OFF"}
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => onRemoveAlert(alert.id)}
                          className="alert-delete-btn"
                          title="Delete alert"
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
                    Create Alert
                  </button>
                ) : (
                  <div className="alert-form">
                    <div className="alert-form-header">
                      <span className="section-label" style={{ marginBottom: 0, marginTop: 0 }}>CREATE ALERT</span>
                      <button onClick={() => setShowForm(false)} className="alert-form-cancel">cancel</button>
                    </div>

                    {/* Type selector */}
                    <div className="alert-type-selector">
                      <button
                        onClick={() => setFormType("price_cross")}
                        className={`alert-type-btn ${formType === "price_cross" ? "active" : ""}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                        Price Cross
                      </button>
                      <button
                        onClick={() => setFormType("new_market")}
                        className={`alert-type-btn ${formType === "new_market" ? "active" : ""}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="16" />
                          <line x1="8" y1="12" x2="16" y2="12" />
                        </svg>
                        New Market
                      </button>
                    </div>

                    {formType === "price_cross" && (
                      <div className="alert-form-fields">
                        {/* Market search */}
                        <div className="alert-field">
                          <label className="alert-field-label">Market</label>
                          <div className="alert-search-wrap">
                            <input
                              type="text"
                              value={formMarketSearch}
                              onChange={(e) => {
                                setFormMarketSearch(e.target.value);
                                setFormMarketId("");
                                setFormMarketTitle("");
                              }}
                              placeholder="Search markets..."
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
                            <label className="alert-field-label">Threshold (%)</label>
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
                            <label className="alert-field-label">Direction</label>
                            <div className="alert-direction-btns">
                              <button
                                onClick={() => setFormDirection("above")}
                                className={`alert-dir-btn ${formDirection === "above" ? "alert-dir-above" : ""}`}
                              >
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M8 12V4M4 7l4-4 4 4" />
                                </svg>
                                Above
                              </button>
                              <button
                                onClick={() => setFormDirection("below")}
                                className={`alert-dir-btn ${formDirection === "below" ? "alert-dir-below" : ""}`}
                              >
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M8 4v8M4 9l4 4 4-4" />
                                </svg>
                                Below
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {formType === "new_market" && (
                      <div className="alert-form-fields">
                        <div className="alert-field">
                          <label className="alert-field-label">Category (optional)</label>
                          <div className="alert-category-grid">
                            <button
                              onClick={() => setFormCategory("")}
                              className={`alert-cat-btn ${!formCategory ? "active" : ""}`}
                            >
                              Any
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
                          <label className="alert-field-label">Tag filter (optional)</label>
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

                    {/* Submit */}
                    <button
                      onClick={handleSubmit}
                      disabled={formType === "price_cross" && (!formMarketId || !formThreshold)}
                      className="alert-submit-btn"
                    >
                      Create Alert
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "history" && (
            <div>
              <div className="alert-section">
                <div className="alert-history-header">
                  <span className="section-label" style={{ marginBottom: 0, marginTop: 0 }}>TRIGGER HISTORY</span>
                  <div className="alert-history-actions">
                    {history.some((h) => !h.read) && (
                      <button onClick={onMarkAllRead} className="alert-history-action">
                        mark all read
                      </button>
                    )}
                    {history.length > 0 && (
                      <button onClick={onClearHistory} className="alert-history-action alert-history-action-danger">
                        clear
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
                    <span>no alerts triggered yet</span>
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
                            <div className="alert-history-time">{formatTime(entry.timestamp)}</div>
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
