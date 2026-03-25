"use client";

import { useCallback, useRef, useMemo, useEffect } from "react";
import { useLocalStorage } from "./useLocalStorage";
import type { ProcessedMarket, Category, WhaleTrade, NewsItem } from "@/types";
import type { SignalType, SmartSignal } from "@/lib/smartSignals";

export type AlertType =
  | "price_cross"
  | "new_market"
  | "smart_signal"
  | "whale_trade"
  | "resolution_imminent"
  | "smart_divergence"
  | "news_impact";

export interface AlertConfig {
  id: string;
  type: AlertType;
  enabled: boolean;
  createdAt: number;
  // price_cross
  marketId?: string;
  marketTitle?: string;
  threshold?: number;
  direction?: "above" | "below";
  lastTriggered?: number;
  // new_market
  category?: Category;
  tag?: string;
  // smart_signal
  signalType?: SignalType;
  signalStrength?: "strong" | "moderate" | "weak";
  // whale_trade
  minUsdcSize?: number; // minimum trade size in USDC
  // resolution_imminent
  hoursBeforeEnd?: number; // alert N hours before end_date
  // smart_divergence (uses marketId + no extra fields)
  // news_impact (uses marketId or tag)
}

export interface AlertHistoryEntry {
  id: string;
  alertId: string;
  type: AlertType;
  message: string;
  marketId?: string;
  marketTitle?: string;
  timestamp: number;
  read: boolean;
}

interface AlertsData {
  version: 1;
  alerts: AlertConfig[];
  history: AlertHistoryEntry[];
}

const DEFAULT: AlertsData = {
  version: 1,
  alerts: [
    {
      id: "default_new_market",
      type: "new_market",
      enabled: true,
      createdAt: Date.now(),
    },
  ],
  history: [],
};

const DEBOUNCE_MS = 5 * 60 * 1000; // 5 min cooldown per alert
const MAX_HISTORY = 100;

export function useAlerts() {
  const [data, setData] = useLocalStorage<AlertsData>("pw:alerts", DEFAULT);

  // Migrate: ensure default new_market alert exists for existing users
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current) return;
    if (!data.alerts.some((a) => a.id === "default_new_market")) {
      migrated.current = true;
      setData((prev) => ({
        ...prev,
        alerts: [
          { id: "default_new_market", type: "new_market", enabled: true, createdAt: Date.now() },
          ...prev.alerts,
        ],
      }));
    }
  }, [data.alerts, setData]);

  const prevProbs = useRef<Map<string, number>>(new Map());

  const unreadCount = useMemo(
    () => data.history.filter((h) => !h.read).length,
    [data.history]
  );

  const addAlert = useCallback(
    (config: Omit<AlertConfig, "id" | "createdAt" | "enabled">) => {
      const alert: AlertConfig = {
        ...config,
        id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt: Date.now(),
        enabled: true,
      };
      setData((prev) => ({
        ...prev,
        alerts: [...prev.alerts, alert],
      }));
      return alert.id;
    },
    [setData]
  );

  const removeAlert = useCallback(
    (id: string) => {
      setData((prev) => ({
        ...prev,
        alerts: prev.alerts.filter((a) => a.id !== id),
      }));
    },
    [setData]
  );

  const toggleAlert = useCallback(
    (id: string) => {
      setData((prev) => ({
        ...prev,
        alerts: prev.alerts.map((a) =>
          a.id === id ? { ...a, enabled: !a.enabled } : a
        ),
      }));
    },
    [setData]
  );

  const evaluateAlerts = useCallback(
    (
      allMarkets: ProcessedMarket[],
      newMarketIds: Set<string>,
      signals?: SmartSignal[],
      trades?: WhaleTrade[],
      newsItems?: NewsItem[],
    ) => {
      const now = Date.now();
      const triggered: { alert: AlertConfig; message: string; marketId?: string; marketTitle?: string }[] = [];

      for (const alert of data.alerts) {
        if (!alert.enabled) continue;

        // Debounce
        if (alert.lastTriggered && now - alert.lastTriggered < DEBOUNCE_MS) continue;

        if (alert.type === "price_cross" && alert.marketId && alert.threshold !== undefined && alert.direction) {
          const market = allMarkets.find((m) => m.id === alert.marketId);
          if (!market || market.prob === null) continue;

          const prevProb = prevProbs.current.get(alert.marketId);
          if (prevProb === undefined) continue; // need two data points

          const threshold = alert.threshold / 100; // stored as percentage
          const crossed =
            alert.direction === "above"
              ? prevProb < threshold && market.prob >= threshold
              : prevProb > threshold && market.prob <= threshold;

          if (crossed) {
            triggered.push({
              alert,
              message: `${market.title}: price crossed ${alert.direction} ${alert.threshold}% (now ${(market.prob * 100).toFixed(1)}%)`,
              marketId: market.id,
              marketTitle: market.title,
            });
          }
        }

        if (alert.type === "new_market" && newMarketIds.size > 0) {
          for (const market of allMarkets) {
            if (!newMarketIds.has(market.id)) continue;
            const catMatch = !alert.category || market.category === alert.category;
            const tagMatch = !alert.tag || market.tags.some((t) => t.toLowerCase().includes(alert.tag!.toLowerCase()));
            if (catMatch && tagMatch) {
              triggered.push({
                alert,
                message: `New market: ${market.title}`,
                marketId: market.id,
                marketTitle: market.title,
              });
              break; // one notification per alert per cycle
            }
          }
        }

        if (alert.type === "smart_signal" && signals && signals.length > 0) {
          const strengthRank = { strong: 3, moderate: 2, weak: 1 };
          const minRank = strengthRank[alert.signalStrength || "weak"];
          for (const sig of signals) {
            const typeMatch = !alert.signalType || sig.type === alert.signalType;
            const strengthMatch = strengthRank[sig.strength] >= minRank;
            if (typeMatch && strengthMatch) {
              triggered.push({
                alert,
                message: sig.summary,
                marketId: undefined,
                marketTitle: sig.market.title,
              });
              break;
            }
          }
        }

        // Whale trade alert: large trades on a specific market or any market
        if (alert.type === "whale_trade" && trades && trades.length > 0) {
          const minSize = alert.minUsdcSize || 5000;
          const recentTrades = trades.filter((t) => {
            const tradeAge = now - new Date(t.timestamp).getTime();
            if (tradeAge > DEBOUNCE_MS) return false;
            if (t.usdcSize < minSize) return false;
            if (alert.marketId && t.eventId !== alert.marketId) return false;
            return true;
          });
          if (recentTrades.length > 0) {
            const biggest = recentTrades.reduce((a, b) => (a.usdcSize > b.usdcSize ? a : b));
            const sizeStr = biggest.usdcSize >= 1000
              ? `$${(biggest.usdcSize / 1000).toFixed(1)}k`
              : `$${biggest.usdcSize.toFixed(0)}`;
            triggered.push({
              alert,
              message: `Whale ${biggest.side} ${sizeStr} on ${biggest.title} (${biggest.outcome} @ ${(biggest.price * 100).toFixed(0)}%)`,
              marketId: biggest.eventId || undefined,
              marketTitle: biggest.title,
            });
          }
        }

        // Resolution imminent: market end_date approaching
        if (alert.type === "resolution_imminent") {
          const hours = alert.hoursBeforeEnd || 24;
          const threshold = hours * 3600_000;
          for (const market of allMarkets) {
            if (!market.endDate || market.closed) continue;
            if (alert.marketId && market.id !== alert.marketId) continue;
            if (alert.category && market.category !== alert.category) continue;
            const endMs = new Date(market.endDate).getTime();
            const remaining = endMs - now;
            if (remaining > 0 && remaining <= threshold) {
              const hoursLeft = Math.round(remaining / 3600_000);
              const timeStr = hoursLeft < 1 ? "< 1h" : `${hoursLeft}h`;
              triggered.push({
                alert,
                message: `Resolution in ${timeStr}: ${market.title} (${market.prob !== null ? (market.prob * 100).toFixed(0) + "%" : "N/A"})`,
                marketId: market.id,
                marketTitle: market.title,
              });
              break;
            }
          }
        }

        // Smart money divergence: smart money opposes market direction
        if (alert.type === "smart_divergence" && trades && trades.length > 0) {
          for (const market of allMarkets) {
            if (market.prob === null || market.closed) continue;
            if (alert.marketId && market.id !== alert.marketId) continue;
            // Find recent smart wallet trades on this market
            const smartTrades = trades.filter(
              (t) => t.isSmartWallet && t.eventId === market.id &&
                (now - new Date(t.timestamp).getTime()) < 6 * 3600_000
            );
            if (smartTrades.length < 2) continue;
            const buyVol = smartTrades.filter((t) => t.side === "BUY").reduce((s, t) => s + t.usdcSize, 0);
            const sellVol = smartTrades.filter((t) => t.side === "SELL").reduce((s, t) => s + t.usdcSize, 0);
            const smartBullish = buyVol > sellVol * 1.5;
            const smartBearish = sellVol > buyVol * 1.5;
            const marketHigh = market.prob > 0.65;
            const marketLow = market.prob < 0.35;
            if ((smartBearish && marketHigh) || (smartBullish && marketLow)) {
              const dir = smartBullish ? "buying" : "selling";
              triggered.push({
                alert,
                message: `Smart money ${dir} while market at ${(market.prob * 100).toFixed(0)}%: ${market.title}`,
                marketId: market.id,
                marketTitle: market.title,
              });
              break;
            }
          }
        }

        // News impact: recent news matching a specific market or tag
        if (alert.type === "news_impact" && newsItems && newsItems.length > 0) {
          const recentNews = newsItems.filter((n) => {
            const age = now - new Date(n.publishedAt).getTime();
            return age < 2 * 3600_000; // 2h
          });
          if (recentNews.length === 0) continue;
          for (const market of allMarkets) {
            if (alert.marketId && market.id !== alert.marketId) continue;
            if (!alert.marketId && !alert.tag) continue;
            const searchTerms = alert.tag
              ? [alert.tag.toLowerCase()]
              : market.title.toLowerCase().split(/\s+/).filter((w) => w.length > 4).slice(0, 5);
            for (const news of recentNews) {
              const titleLower = news.title.toLowerCase();
              const hits = searchTerms.filter((t) => titleLower.includes(t)).length;
              if (hits >= Math.min(2, searchTerms.length)) {
                triggered.push({
                  alert,
                  message: `News: "${news.title}" (${news.source}) may impact ${market.title}`,
                  marketId: market.id,
                  marketTitle: market.title,
                });
                break;
              }
            }
            if (triggered.some((t) => t.alert.id === alert.id)) break;
          }
        }
      }

      // Update prevProbs for next cycle
      for (const market of allMarkets) {
        if (market.prob !== null) {
          prevProbs.current.set(market.id, market.prob);
        }
      }

      if (triggered.length > 0) {
        setData((prev) => {
          const newHistory: AlertHistoryEntry[] = triggered.map((t) => ({
            id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            alertId: t.alert.id,
            type: t.alert.type,
            message: t.message,
            marketId: t.marketId,
            marketTitle: t.marketTitle,
            timestamp: now,
            read: false,
          }));

          const updatedAlerts = prev.alerts.map((a) => {
            const match = triggered.find((t) => t.alert.id === a.id);
            return match ? { ...a, lastTriggered: now } : a;
          });

          return {
            ...prev,
            alerts: updatedAlerts,
            history: [...newHistory, ...prev.history].slice(0, MAX_HISTORY),
          };
        });
      }

      return triggered;
    },
    [data.alerts, setData]
  );

  const markRead = useCallback(
    (id: string) => {
      setData((prev) => ({
        ...prev,
        history: prev.history.map((h) =>
          h.id === id ? { ...h, read: true } : h
        ),
      }));
    },
    [setData]
  );

  const markAllRead = useCallback(() => {
    setData((prev) => ({
      ...prev,
      history: prev.history.map((h) => ({ ...h, read: true })),
    }));
  }, [setData]);

  const clearHistory = useCallback(() => {
    setData((prev) => ({ ...prev, history: [] }));
  }, [setData]);

  /** Push entries directly into alert history (e.g. new market notifications). */
  const pushHistory = useCallback(
    (entries: Omit<AlertHistoryEntry, "id" | "timestamp" | "read">[]) => {
      if (entries.length === 0) return;
      const now = Date.now();
      setData((prev) => ({
        ...prev,
        history: [
          ...entries.map((e, i) => ({
            ...e,
            id: `hist_${now}_${i}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: now,
            read: false,
          })),
          ...prev.history,
        ].slice(0, MAX_HISTORY),
      }));
    },
    [setData]
  );

  return {
    alerts: data.alerts,
    history: data.history,
    unreadCount,
    addAlert,
    removeAlert,
    toggleAlert,
    evaluateAlerts,
    markRead,
    markAllRead,
    clearHistory,
    pushHistory,
  };
}
