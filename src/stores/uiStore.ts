import { create } from "zustand";
import type { PanelVisibility } from "@/components/SettingsModal";
import type { TimeRange } from "@/components/TimeRangeFilter";
import type { Category } from "@/types";

const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  markets: true, detail: true, country: true, news: true, live: true,
  watchlist: true, leaderboard: true, smartMoney: true, whaleTrades: true,
  orderbook: true, sentiment: true, tweets: true, trader: true, chart: true,
  arbitrage: true, calendar: true, signals: true, resolution: true, portfolio: true,
};

const DEFAULT_PANEL_ORDER = [
  "markets", "watchlist", "signals", "smartMoney", "whaleTrades",
  "news", "tweets", "sentiment", "leaderboard", "chart",
  "portfolio", "trader", "arbitrage", "resolution", "calendar", "live", "country",
];

interface UIState {
  isFullscreen: boolean;
  settingsOpen: boolean;
  alertManagerOpen: boolean;
  isDragging: boolean;
  mapWidthPct: number;
  bottomPanelHeight: number;
  bottomPanelCollapsed: boolean;
  marketSearch: string | undefined;
  region: string;
  colorMode: "category" | "impact";
  autoRefresh: boolean;
  timeRange: TimeRange;
  activeCategories: Set<Category>;
  panelVisibility: PanelVisibility;
  panelOrder: string[];
  bottomPanelOrder: string[];
  alertPrefill: { marketId?: string; marketTitle?: string } | undefined;
  activeMobilePanel: string | null;
}

interface UIActions {
  setIsFullscreen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setAlertManagerOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setIsDragging: (v: boolean) => void;
  setMapWidthPct: (v: number | ((prev: number) => number)) => void;
  setBottomPanelHeight: (v: number | ((prev: number) => number)) => void;
  setBottomPanelCollapsed: (v: boolean) => void;
  toggleBottomPanel: () => void;
  setMarketSearch: (v: string | undefined) => void;
  setRegion: (v: string) => void;
  setColorMode: (v: "category" | "impact") => void;
  setAutoRefresh: (v: boolean | ((prev: boolean) => boolean)) => void;
  setTimeRange: (v: TimeRange) => void;
  setActiveCategories: (v: Set<Category> | ((prev: Set<Category>) => Set<Category>)) => void;
  setPanelVisibility: (v: PanelVisibility | ((prev: PanelVisibility) => PanelVisibility)) => void;
  setPanelOrder: (v: string[] | ((prev: string[]) => string[])) => void;
  setBottomPanelOrder: (v: string[] | ((prev: string[]) => string[])) => void;
  setAlertPrefill: (v: UIState["alertPrefill"]) => void;
  setActiveMobilePanel: (v: string | null) => void;
  toggleCategory: (cat: Category) => void;
  togglePanelVisibility: (panel: string) => void;
  toggleFullscreen: () => void;
  hydrateFromPrefs: (prefs: {
    activeCategories: string[];
    timeRange: string;
    autoRefresh: boolean;
    mapWidthPct: number;
    region: string;
    colorMode: "category" | "impact";
    panelVisibility: Partial<PanelVisibility>;
    panelOrder: string[];
    bottomPanelOrder?: string[];
  }) => void;
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  isFullscreen: false,
  settingsOpen: false,
  alertManagerOpen: false,
  isDragging: false,
  mapWidthPct: 60,
  bottomPanelHeight: typeof window !== "undefined" && window.innerWidth <= 768 ? 200 : 360,
  bottomPanelCollapsed: false,
  marketSearch: undefined,
  region: "global",
  colorMode: "category",
  autoRefresh: true,
  timeRange: "ALL" as TimeRange,
  activeCategories: new Set(["Politics", "Crypto", "Sports", "Finance", "Tech", "Culture", "Other"] as Category[]),
  panelVisibility: { ...DEFAULT_PANEL_VISIBILITY },
  panelOrder: [...DEFAULT_PANEL_ORDER],
  bottomPanelOrder: ["detail", "orderbook"],
  alertPrefill: undefined,
  activeMobilePanel: null,

  setIsFullscreen: (v) => set({ isFullscreen: v }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setAlertManagerOpen: (v) => set((s) => ({
    alertManagerOpen: typeof v === "function" ? v(s.alertManagerOpen) : v,
  })),
  setIsDragging: (v) => set({ isDragging: v }),
  setMapWidthPct: (v) => set((s) => ({
    mapWidthPct: typeof v === "function" ? v(s.mapWidthPct) : v,
  })),
  setBottomPanelHeight: (v) => set((s) => ({
    bottomPanelHeight: typeof v === "function" ? v(s.bottomPanelHeight) : v,
  })),
  setBottomPanelCollapsed: (v) => set({ bottomPanelCollapsed: v }),
  toggleBottomPanel: () => set((s) => ({ bottomPanelCollapsed: !s.bottomPanelCollapsed })),
  setActiveMobilePanel: (v) => set({ activeMobilePanel: v }),
  setMarketSearch: (v) => set({ marketSearch: v }),
  setRegion: (v) => set({ region: v }),
  setColorMode: (v) => set({ colorMode: v }),
  setAutoRefresh: (v) => set((s) => ({
    autoRefresh: typeof v === "function" ? v(s.autoRefresh) : v,
  })),
  setTimeRange: (v) => set({ timeRange: v }),
  setActiveCategories: (v) => set((s) => ({
    activeCategories: typeof v === "function" ? v(s.activeCategories) : v,
  })),
  setPanelVisibility: (v) => set((s) => ({
    panelVisibility: typeof v === "function" ? v(s.panelVisibility) : v,
  })),
  setPanelOrder: (v) => set((s) => ({
    panelOrder: typeof v === "function" ? v(s.panelOrder) : v,
  })),
  setBottomPanelOrder: (v) => set((s) => ({
    bottomPanelOrder: typeof v === "function" ? v(s.bottomPanelOrder) : v,
  })),
  setAlertPrefill: (v) => set({ alertPrefill: v }),

  toggleCategory: (cat) => set((s) => {
    const next = new Set(s.activeCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    return { activeCategories: next };
  }),

  togglePanelVisibility: (panel) => set((s) => ({
    panelVisibility: { ...s.panelVisibility, [panel]: !s.panelVisibility[panel as keyof PanelVisibility] },
  })),

  toggleFullscreen: () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      set({ isFullscreen: true });
    } else {
      document.exitFullscreen().catch(() => {});
      set({ isFullscreen: false });
    }
  },

  hydrateFromPrefs: (prefs) => {
    let po = prefs.panelOrder;
    if (!po.includes("sentiment")) po = ["sentiment", ...po];
    if (!po.includes("watchlist")) po = ["watchlist", ...po];
    if (!po.includes("smartMoney")) po = [...po, "smartMoney"];
    if (!po.includes("leaderboard")) po = [...po, "leaderboard"];
    if (!po.includes("whaleTrades")) po = [...po, "whaleTrades"];
    if (!po.includes("orderbook")) po = [...po, "orderbook"];
    if (!po.includes("tweets")) po = [...po, "tweets"];
    if (!po.includes("trader")) po = [...po, "trader"];
    if (!po.includes("chart")) po = [...po, "chart"];
    if (!po.includes("arbitrage")) po = [...po, "arbitrage"];
    if (!po.includes("calendar")) po = [...po, "calendar"];
    if (!po.includes("signals")) po = [...po, "signals"];
    if (!po.includes("resolution")) po = [...po, "resolution"];
    if (!po.includes("portfolio")) po = [...po, "portfolio"];

    let bpo = prefs.bottomPanelOrder;
    if (!bpo || !Array.isArray(bpo)) bpo = ["detail", "orderbook"];
    if (!bpo.includes("orderbook")) bpo = [...bpo, "orderbook"];
    po = po.filter((id) => !bpo.includes(id));

    set({
      activeCategories: new Set(prefs.activeCategories as Category[]),
      timeRange: prefs.timeRange as TimeRange,
      autoRefresh: prefs.autoRefresh,
      mapWidthPct: prefs.mapWidthPct,
      region: prefs.region,
      colorMode: prefs.colorMode,
      panelVisibility: { ...DEFAULT_PANEL_VISIBILITY, ...prefs.panelVisibility },
      panelOrder: po,
      bottomPanelOrder: bpo,
    });
  },
}));
