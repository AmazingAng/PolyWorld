"use client";

import { useCallback, useRef, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";
import type { ProcessedMarket, Category } from "@/types";

export interface AlertConfig {
  id: string;
  type: "price_cross" | "new_market";
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
}

export interface AlertHistoryEntry {
  id: string;
  alertId: string;
  type: "price_cross" | "new_market";
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
  alerts: [],
  history: [],
};

const DEBOUNCE_MS = 5 * 60 * 1000; // 5 min cooldown per alert
const MAX_HISTORY = 100;

export function useAlerts() {
  const [data, setData] = useLocalStorage<AlertsData>("pw:alerts", DEFAULT);
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
    (allMarkets: ProcessedMarket[], newMarketIds: Set<string>) => {
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
  };
}
