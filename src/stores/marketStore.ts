import { create } from "zustand";
import type { ProcessedMarket } from "@/types";

interface MarketState {
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
  loading: boolean;
  dataMode: "live" | "sample";
  lastRefresh: string | null;
  lastSyncTime: string | null;
  signals: ProcessedMarket[];
  newMarkets: ProcessedMarket[];
  selectedMarket: ProcessedMarket | null;
  selectedOutcomeTokenId: string | null;
  selectedCountry: string | null;
  flyToTarget: { coords: [number, number]; marketId: string } | null;
}

interface MarketActions {
  setMapped: (mapped: ProcessedMarket[]) => void;
  setUnmapped: (unmapped: ProcessedMarket[]) => void;
  setLoading: (loading: boolean) => void;
  setDataMode: (mode: "live" | "sample") => void;
  setLastRefresh: (time: string | null) => void;
  setLastSyncTime: (time: string | null) => void;
  setSignals: (signals: ProcessedMarket[]) => void;
  setNewMarkets: (markets: ProcessedMarket[]) => void;
  selectMarket: (market: ProcessedMarket | null) => void;
  setSelectedOutcomeTokenId: (tokenId: string | null) => void;
  selectCountry: (country: string | null) => void;
  setFlyToTarget: (target: MarketState["flyToTarget"]) => void;
}

export const useMarketStore = create<MarketState & MarketActions>((set) => ({
  mapped: [],
  unmapped: [],
  loading: true,
  dataMode: "live",
  lastRefresh: null,
  lastSyncTime: null,
  signals: [],
  newMarkets: [],
  selectedMarket: null,
  selectedOutcomeTokenId: null,
  selectedCountry: null,
  flyToTarget: null,

  setMapped: (mapped) => set({ mapped }),
  setUnmapped: (unmapped) => set({ unmapped }),
  setLoading: (loading) => set({ loading }),
  setDataMode: (dataMode) => set({ dataMode }),
  setLastRefresh: (lastRefresh) => set({ lastRefresh }),
  setLastSyncTime: (lastSyncTime) => set({ lastSyncTime }),
  setSignals: (signals) => set({ signals }),
  setNewMarkets: (newMarkets) => set({ newMarkets }),
  setSelectedOutcomeTokenId: (tokenId) => set({ selectedOutcomeTokenId: tokenId }),
  selectMarket: (market) => {
    set({ selectedMarket: market, selectedOutcomeTokenId: null });
    try {
      if (market) sessionStorage.setItem("pw:selectedMarket", market.slug);
      else sessionStorage.removeItem("pw:selectedMarket");
      // Sync URL deep link — use slug for human-readable URLs
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (market) url.searchParams.set("m", market.slug);
        else url.searchParams.delete("m");
        window.history.replaceState(null, "", url.toString());
      }
    } catch {}
  },
  selectCountry: (country) => {
    set({ selectedCountry: country });
    try {
      if (country) sessionStorage.setItem("pw:selectedCountry", country);
      else sessionStorage.removeItem("pw:selectedCountry");
    } catch {}
  },
  setFlyToTarget: (flyToTarget) => set({ flyToTarget }),
}));
