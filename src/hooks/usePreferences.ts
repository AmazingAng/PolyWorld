"use client";

import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";
import type { PanelVisibility } from "@/components/SettingsModal";

export interface UserPreferences {
  version: 1;
  panelVisibility: PanelVisibility;
  panelOrder: string[];
  activeCategories: string[];
  timeRange: string;
  colorMode: "category" | "impact";
  region: string;
  autoRefresh: boolean;
  mapWidthPct: number;
  bottomPanelOrder: string[];
}

const DEFAULT_PREFERENCES: UserPreferences = {
  version: 1,
  panelVisibility: {
    markets: true,
    detail: true,
    country: true,
    news: true,
    live: true,
    watchlist: true,
    leaderboard: true,
    smartMoney: true,
    whaleTrades: true,
    orderbook: true,
    sentiment: true,
    tweets: true,
    trader: true,
    chart: true,
  },
  panelOrder: ["sentiment", "watchlist", "markets", "country", "news", "tweets", "live", "leaderboard", "trader", "smartMoney", "whaleTrades", "orderbook", "chart"],
  activeCategories: [
    "Politics", "Crypto", "Sports",
    "Finance", "Tech", "Culture", "Other",
  ],
  timeRange: "ALL",
  colorMode: "category",
  region: "global",
  autoRefresh: true,
  mapWidthPct: 58,
  bottomPanelOrder: ["detail"],
};

export function usePreferences() {
  const [prefs, setPrefs, hydrated] = useLocalStorage<UserPreferences>(
    "pw:preferences",
    DEFAULT_PREFERENCES
  );

  const updatePref = useCallback(
    <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
      setPrefs((prev) => ({ ...prev, [key]: value }));
    },
    [setPrefs]
  );

  return { prefs, updatePref, hydrated };
}
