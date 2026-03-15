import { create } from "zustand";
import type { ProcessedMarket } from "@/types";

export type TradeToastType = "submitting" | "success" | "error";

export interface TradeToast {
  id: string;
  type: TradeToastType;
  label: string;  // explicit display label, e.g. "order matched" / "order placed"
  title: string;
  detail?: string;
  timestamp: number;
}

export type MarketToastType = "signal" | "new" | "batch";

export interface MarketToast {
  id: string;
  type: MarketToastType;
  market?: ProcessedMarket;
  batchCount?: number;
  timestamp: number;
}

const MARKET_TOAST_TTL = 5_000;

interface ToastState {
  tradeToasts: TradeToast[];
  marketToasts: MarketToast[];
  addTradeToast: (type: TradeToastType, label: string, title: string, detail?: string) => void;
  dismissTradeToast: (id: string) => void;
  enqueueSignalToasts: (markets: ProcessedMarket[]) => void;
  enqueueNewMarketToasts: (markets: ProcessedMarket[]) => void;
  dismissMarketToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  tradeToasts: [],
  marketToasts: [],

  addTradeToast: (type, label, title, detail) => {
    const toast: TradeToast = {
      id: `trade-${Date.now()}-${Math.random()}`,
      type,
      label,
      title,
      detail,
      timestamp: Date.now(),
    };
    set((s) => ({ tradeToasts: [...s.tradeToasts, toast].slice(-6) }));
    // Auto-dismiss after 5s (success/error), 30s (submitting)
    const ttl = type === "submitting" ? 30_000 : 5_000;
    setTimeout(() => {
      set((s) => ({ tradeToasts: s.tradeToasts.filter((t) => t.id !== toast.id) }));
    }, ttl);
  },

  dismissTradeToast: (id) =>
    set((s) => ({ tradeToasts: s.tradeToasts.filter((t) => t.id !== id) })),

  enqueueSignalToasts: (markets) => {
    if (markets.length === 0) return;
    const items: MarketToast[] = markets.map((m) => ({
      id: `sig-${m.id}-${Date.now()}`,
      market: m,
      type: "signal" as const,
      timestamp: Date.now(),
    }));
    set((s) => ({ marketToasts: [...items, ...s.marketToasts].slice(0, 6) }));
    const ids = items.map((i) => i.id);
    setTimeout(() => {
      set((s) => ({ marketToasts: s.marketToasts.filter((t) => !ids.includes(t.id)) }));
    }, MARKET_TOAST_TTL);
  },

  enqueueNewMarketToasts: (markets) => {
    if (markets.length === 0) return;
    let items: MarketToast[];
    if (markets.length > 3) {
      const batchItem: MarketToast = {
        id: `batch-${Date.now()}`,
        type: "batch",
        timestamp: Date.now(),
        batchCount: markets.length,
      };
      const individual: MarketToast[] = markets.slice(0, 2).map((m) => ({
        id: `new-${m.id}-${Date.now()}`,
        market: m,
        type: "new" as const,
        timestamp: Date.now(),
      }));
      items = [batchItem, ...individual];
    } else {
      items = markets.slice(0, 3).map((m) => ({
        id: `new-${m.id}-${Date.now()}`,
        market: m,
        type: "new" as const,
        timestamp: Date.now(),
      }));
    }
    set((s) => ({ marketToasts: [...items, ...s.marketToasts].slice(0, 6) }));
    const ids = items.map((i) => i.id);
    setTimeout(() => {
      set((s) => ({ marketToasts: s.marketToasts.filter((t) => !ids.includes(t.id)) }));
    }, MARKET_TOAST_TTL);
  },

  dismissMarketToast: (id) =>
    set((s) => ({ marketToasts: s.marketToasts.filter((t) => t.id !== id) })),
}));
