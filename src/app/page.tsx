"use client";

import { useState, useEffect, useCallback, useRef, useMemo, useId, lazy, Suspense } from "react";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  pointerWithin,
  closestCorners,
  MeasuringStrategy,
  type CollisionDetection,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import dynamic from "next/dynamic";
import { ProcessedMarket } from "@/types";
import type { OverlayLayer } from "@/components/MapToolbar";
import { processEvents, getSampleData } from "@/lib/polymarket";
import { resolveCountryName } from "@/lib/countries";
import { getParentCountry } from "@/lib/geo";
import { findSimilarMarkets } from "@/lib/correlation";
import Header from "@/components/Header";
const MarketPreview = lazy(() => import("@/components/MarketPreview"));
import Panel from "@/components/Panel";
import MarketsPanel from "@/components/MarketsPanel";
import MarketDetailPanel from "@/components/MarketDetailPanel";
import CountryPanel from "@/components/CountryPanel";
import LivePanel, { LiveChannelDropdown } from "@/components/LivePanel";
import type { StreamSource } from "@/lib/streams";
import NewsPanel from "@/components/NewsPanel";
import SettingsModal from "@/components/SettingsModal";
import type { PanelVisibility } from "@/components/SettingsModal";
import ToastContainer from "@/components/Toast";
import { usePanelDrag } from "@/hooks/usePanelDrag";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";
import ResizeHandle from "@/components/ResizeHandle";
import { usePreferences } from "@/hooks/usePreferences";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useAlerts } from "@/hooks/useAlerts";
import { useBrowserNotifications } from "@/hooks/useBrowserNotifications";
import WatchlistPanel from "@/components/WatchlistPanel";
import SmartMoneyPanel from "@/components/SmartMoneyPanel";
import LeaderboardPanel, { type LeaderboardPeriod } from "@/components/LeaderboardPanel";
import WhaleTradesPanel from "@/components/WhaleTradesPanel";
import OrderBookPanel from "@/components/OrderBook";
import ChartPanel from "@/components/ChartPanel";
import SentimentPanel from "@/components/SentimentPanel";
import TweetsPanel from "@/components/TweetsPanel";
import TraderPanel from "@/components/TraderPanel";
import ArbitragePanel from "@/components/ArbitragePanel";
import CalendarPanel from "@/components/CalendarPanel";
import SignalPanel from "@/components/SignalPanel";
import TradeModal, { type TradeModalState } from "@/components/TradeModal";
import ResolutionPanel from "@/components/ResolutionPanel";
import PortfolioPanel from "@/components/PortfolioPanel";
import OpenOrdersPanel from "@/components/OpenOrdersPanel";
import FilterDropdown from "@/components/FilterDropdown";
import { detectSignals } from "@/lib/smartSignals";
import OnboardingModal from "@/components/OnboardingModal";
import Footer from "@/components/Footer";
import PanelErrorBoundary from "@/components/PanelErrorBoundary";
import DraggablePanelItem from "@/components/DraggablePanelItem";
import PanelDragOverlay from "@/components/PanelDragOverlay";
import type { PanelDragHandleProps } from "@/components/panelDragTypes";
import { usePanelColSpans } from "@/hooks/usePanelColSpans";
import { usePanelRowSpans } from "@/hooks/usePanelRowSpans";
import { useMarketStore } from "@/stores/marketStore";
import { useSmartMoneyStore } from "@/stores/smartMoneyStore";
import { useUIStore } from "@/stores/uiStore";
import { useToastStore } from "@/stores/toastStore";
import { useI18n } from "@/i18n";

const WorldMap = dynamic(() => import("@/components/WorldMap"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 bg-[#0a0a0a] flex items-center justify-center">
      <div className="text-center font-mono">
        <div className="w-6 h-6 border border-[#2a2a2a] border-t-[#a0a0a0] rounded-full animate-spin mx-auto mb-2" />
        <p className="text-[12px] text-[#777]">Loading map&hellip;</p>
      </div>
    </div>
  ),
});

const REFRESH_INTERVAL = 45000;

const DEFAULT_COL_SPANS: Record<string, number> = {
  markets: 1, country: 1, news: 1, tweets: 1, live: 1, watchlist: 1, detail: 2, leaderboard: 1, trader: 1, smartMoney: 1, whaleTrades: 1, orderbook: 1, sentiment: 1, chart: 1, arbitrage: 1, calendar: 1, signals: 1, resolution: 1, portfolio: 1, openOrders: 1,
};

// Panel titles are derived from i18n — computed inside renderPanel via t()

// Time range → max age in milliseconds (0 = no filter)
const TIME_MAX_AGE: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "48h": 48 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  ALL: 0,
};

function PanelDropPreview({
  panelId,
  title,
  colSpan,
  rowSpan,
  dragRootRef,
  dragHandleProps,
  dragStyle,
  dragClassName,
}: {
  panelId: string;
  title: string;
  colSpan: number;
  rowSpan: number;
  dragRootRef?: React.Ref<HTMLDivElement>;
  dragHandleProps?: PanelDragHandleProps;
  dragStyle?: React.CSSProperties;
  dragClassName?: string;
}) {
  void dragHandleProps;
  const { t } = useI18n();
  const style: React.CSSProperties = {};
  if (colSpan > 1) style.gridColumn = `span ${colSpan}`;
  if (rowSpan !== 2) style.gridRow = `span ${rowSpan}`;
  if (dragStyle) Object.assign(style, dragStyle);

  return (
    <div
      ref={dragRootRef}
      data-panel={panelId}
      className={`panel-drop-placeholder${dragClassName ? ` ${dragClassName}` : ""}`}
      style={style}
      aria-hidden="true"
    >
      <div className="panel-drop-placeholder__header">
        <span className="panel-drop-placeholder__label">{title}</span>
      </div>
      <div className="panel-drop-placeholder__body">
        <span className="panel-drop-placeholder__hint">{t("common.dropPreview")}</span>
      </div>
    </div>
  );
}

export default function Home() {
  const dndId = useId();
  const { t } = useI18n();
  const { prefs, updatePref, hydrated: prefsReady } = usePreferences();
  const [refreshError, setRefreshError] = useState(false);

  // ─── Market Store ───
  const mapped = useMarketStore((s) => s.mapped);
  const unmapped = useMarketStore((s) => s.unmapped);
  const loading = useMarketStore((s) => s.loading);
  const dataMode = useMarketStore((s) => s.dataMode);
  const lastRefresh = useMarketStore((s) => s.lastRefresh);
  const lastSyncTime = useMarketStore((s) => s.lastSyncTime);
  const signals = useMarketStore((s) => s.signals);
  const newMarkets = useMarketStore((s) => s.newMarkets);

  // ─── Toast Store ───
  const enqueueSignalToasts = useToastStore((s) => s.enqueueSignalToasts);
  const enqueueNewMarketToasts = useToastStore((s) => s.enqueueNewMarketToasts);

  const prevSignalsRef = useRef<typeof signals>(signals);
  useEffect(() => {
    if (signals === prevSignalsRef.current) return;
    prevSignalsRef.current = signals;
    enqueueSignalToasts(signals);
  }, [signals, enqueueSignalToasts]);

  const prevNewMarketsRef = useRef<typeof newMarkets>(newMarkets);
  useEffect(() => {
    if (newMarkets === prevNewMarketsRef.current) return;
    prevNewMarketsRef.current = newMarkets;
    enqueueNewMarketToasts(newMarkets);
  }, [newMarkets, enqueueNewMarketToasts]);

  const selectedMarket = useMarketStore((s) => s.selectedMarket);
  const selectedOutcomeTokenId = useMarketStore((s) => s.selectedOutcomeTokenId);
  const selectedCountry = useMarketStore((s) => s.selectedCountry);
  const flyToTarget = useMarketStore((s) => s.flyToTarget);

  // Derive human-readable outcome label for the orderbook header
  const orderbookOutcomeName = useMemo(() => {
    if (!selectedMarket || !selectedOutcomeTokenId) return null;
    for (const m of selectedMarket.markets) {
      if (m.active === false) continue;
      const raw = m.clobTokenIds;
      if (!raw) continue;
      try {
        const ids: string[] = Array.isArray(raw) ? raw : JSON.parse(raw as unknown as string);
        const label = m.groupItemTitle || m.question || "";
        if (ids[0] === selectedOutcomeTokenId) return label ? `${label} · Yes` : "Yes";
        if (ids[1] === selectedOutcomeTokenId) return label ? `${label} · No`  : "No";
      } catch { /* skip */ }
    }
    return null;
  }, [selectedMarket, selectedOutcomeTokenId]);

  const defaultOrderbookOutcomeName = useMemo(() => {
    if (!selectedMarket) return null;
    const m = selectedMarket.markets.find((m) => m.active !== false);
    if (!m) return null;
    const label = m.groupItemTitle || "";
    return label ? `${label} · Yes` : "Yes";
  }, [selectedMarket]);

  // ─── Smart Money Store ───
  const smartMoneyLeaderboard = useSmartMoneyStore((s) => s.leaderboard);
  const leaderboardPeriod = useSmartMoneyStore((s) => s.leaderboardPeriod);
  const smartMoneyTrades = useSmartMoneyStore((s) => s.trades);
  const smartMoneySmartTrades = useSmartMoneyStore((s) => s.smartTrades);
  const traderPanelWallet = useSmartMoneyStore((s) => s.traderPanelWallet);
  const traderWalletName = useSmartMoneyStore((s) => s.traderWalletName);
  const traderAddrInput = useSmartMoneyStore((s) => s.traderAddrInput);
  const smartWalletFilter = useSmartMoneyStore((s) => s.walletFilter);

  // ─── UI Store ───
  const isFullscreen = useUIStore((s) => s.isFullscreen);
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const alertManagerOpen = useUIStore((s) => s.alertManagerOpen);
  const mapWidthPct = useUIStore((s) => s.mapWidthPct);
  const bottomPanelHeight = useUIStore((s) => s.bottomPanelHeight);
  const bottomPanelCollapsed = useUIStore((s) => s.bottomPanelCollapsed);
  const activeMobilePanel = useUIStore((s) => s.activeMobilePanel);
  const marketSearch = useUIStore((s) => s.marketSearch);
  const region = useUIStore((s) => s.region);
  const colorMode = useUIStore((s) => s.colorMode);
  const autoRefresh = useUIStore((s) => s.autoRefresh);
  const timeRange = useUIStore((s) => s.timeRange);
  const activeCategories = useUIStore((s) => s.activeCategories);
  const panelVisibility = useUIStore((s) => s.panelVisibility);
  const panelOrder = useUIStore((s) => s.panelOrder);
  const bottomPanelOrder = useUIStore((s) => s.bottomPanelOrder);
  const alertPrefill = useUIStore((s) => s.alertPrefill);

  // Stable action selectors — Zustand actions never change identity
  const setTimeRange = useUIStore((s) => s.setTimeRange);
  const toggleCategory = useUIStore((s) => s.toggleCategory);
  const toggleFullscreen = useUIStore((s) => s.toggleFullscreen);
  const setColorMode = useUIStore((s) => s.setColorMode);
  const setRegion = useUIStore((s) => s.setRegion);
  const togglePanelVisibility = useUIStore((s) => s.togglePanelVisibility);

  // ─── Map overlay layers (persisted to localStorage) ───
  const [activeLayers, setActiveLayers] = useState<Set<OverlayLayer>>(new Set());
  const [traderPrefsReady, setTraderPrefsReady] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("polyworld:activeLayers");
      if (saved) {
        setActiveLayers(new Set(JSON.parse(saved) as OverlayLayer[]));
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    useSmartMoneyStore.getState().hydrateTraderPrefs();
    setTraderPrefsReady(true);
  }, []);
  const toggleOverlayLayer = useCallback((layer: OverlayLayer) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer); else next.add(layer);
      try { localStorage.setItem("polyworld:activeLayers", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // ─── Panel filter state ───
  const [sigStrFilter, setSigStrFilter] = useState<Set<string>>(new Set());
  const [sigCatFilter, setSigCatFilter] = useState<Set<string>>(new Set());
  const [resStrFilter, setResStrFilter] = useState<Set<string>>(new Set());
  const [resCatFilter, setResCatFilter] = useState<Set<string>>(new Set());
  const [newsFollowMarket, setNewsFollowMarket] = useState(false);
  const [tweetsFollowMarket, setTweetsFollowMarket] = useState(false);
  const [newsSourceFilter, setNewsSourceFilter] = useState<Set<string>>(new Set());
  const [newsActiveSources, setNewsActiveSources] = useState<string[]>([]);
  const [tweetsHandleFilter, setTweetsHandleFilter] = useState<Set<string>>(new Set());
  const [tweetsActiveHandles, setTweetsActiveHandles] = useState<string[]>([]);
  const [liveActiveStream, setLiveActiveStream] = useState<StreamSource | null>(null);

  const panelsRef = useRef<HTMLDivElement>(null);
  const bottomPanelsRef = useRef<HTMLDivElement>(null);
  const { setNodeRef: setRightDroppableRef } = useDroppable({ id: "panel-grid-right" });
  const { setNodeRef: setBottomDroppableRef } = useDroppable({ id: "panel-grid-bottom" });

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 768px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Mobile market preview popup
  const [mobilePreview, setMobilePreview] = useState<ProcessedMarket | null>(null);

  // Watchlist
  const { watchedIds, isWatched, toggleWatch, count: watchedCount, addedAt } = useWatchlist();
  const { getColSpan, setColSpan, resetColSpan } = usePanelColSpans();
  const { getRowSpan, setRowSpan, resetRowSpan } = usePanelRowSpans();
  const rowSpanFor = (id: string) => getRowSpan(id, 2);

  // Pre-generate stable handler objects for all panels (avoids inline arrow functions in renderPanel)
  const panelHandlers = useMemo(() => {
    const ids = ["detail", "markets", "country", "news", "tweets", "live", "watchlist", "leaderboard", "smartMoney", "whaleTrades", "orderbook", "trader", "sentiment", "chart", "arbitrage", "calendar", "signals", "resolution", "portfolio", "openOrders"];
    const h: Record<string, { onColSpanChange: (s: number) => void; onColSpanReset: () => void; onRowSpanChange: (s: number) => void; onRowSpanReset: () => void }> = {};
    for (const id of ids) {
      h[id] = {
        onColSpanChange: (s: number) => setColSpan(id, s),
        onColSpanReset: () => resetColSpan(id),
        onRowSpanChange: (s: number) => setRowSpan(id, s),
        onRowSpanReset: () => resetRowSpan(id),
      };
    }
    return h;
  }, [setColSpan, resetColSpan, setRowSpan, resetRowSpan]);

  // Alerts
  const { alerts, history: alertHistory, unreadCount, addAlert, removeAlert, toggleAlert, evaluateAlerts, markRead, markAllRead, clearHistory } = useAlerts();
  const { sendNotification, requestPermission, permission: notifPermission } = useBrowserNotifications();

  // Hydrate stores from prefs once localStorage has loaded
  const prefsHydrated = useRef(false);
  useEffect(() => {
    if (!prefsReady || prefsHydrated.current) return;
    prefsHydrated.current = true;
    useUIStore.getState().hydrateFromPrefs(prefs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsReady]);

  // Apply mobile default for bottom panel height after mount (avoids SSR/client hydration mismatch)
  useEffect(() => {
    const current = useUIStore.getState().bottomPanelHeight;
    if (current !== 360) return;
    useUIStore.getState().setBottomPanelHeight(window.innerWidth <= 768 ? 200 : 360);
  }, []);

  // Sync all preferences back to localStorage in a single debounced effect
  const prefSyncTimer = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!prefsHydrated.current) return;
    if (prefSyncTimer.current) clearTimeout(prefSyncTimer.current);
    prefSyncTimer.current = setTimeout(() => {
      updatePref("activeCategories", Array.from(activeCategories));
      updatePref("timeRange", timeRange);
      updatePref("autoRefresh", autoRefresh);
      updatePref("panelVisibility", panelVisibility);
      updatePref("panelOrder", panelOrder);
      updatePref("bottomPanelOrder", bottomPanelOrder);
      updatePref("mapWidthPct", mapWidthPct);
      updatePref("colorMode", colorMode);
      updatePref("region", region);
    }, 300);
    return () => { if (prefSyncTimer.current) clearTimeout(prefSyncTimer.current); };
  }, [activeCategories, timeRange, autoRefresh, panelVisibility, panelOrder, bottomPanelOrder, mapWidthPct, colorMode, region, updatePref]);

  const mainRef = useRef<HTMLDivElement>(null);
  const mapSectionRef = useRef<HTMLDivElement>(null);

  const handleHorizontalResize = useCallback((delta: number) => {
    const sectionH = mapSectionRef.current?.getBoundingClientRect().height;
    if (!sectionH) return;
    useUIStore.getState().setBottomPanelHeight((prev) => Math.max(120, Math.min(sectionH - 120, prev - delta)));
  }, []);

  const handleVerticalResize = useCallback((delta: number) => {
    const totalW = mainRef.current?.getBoundingClientRect().width;
    if (!totalW) return;
    useUIStore.getState().setMapWidthPct((prev) => Math.max(30, Math.min(80, prev + (delta / totalW) * 100)));
  }, []);

  const flyToTimer = useRef<NodeJS.Timeout | null>(null);
  const seenSignalIds = useRef<Set<string>>(new Set());
  const seenMarketIds = useRef<Set<string>>(new Set());
  const isFirstLoad = useRef(true);
  const lbCacheRef = useRef<Record<string, import("@/types").SmartWallet[]>>({});

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    const { setMapped, setUnmapped, setLoading, setDataMode, setLastSyncTime, setSignals, setNewMarkets, setLastRefresh } = useMarketStore.getState();
    setLoading(true);
    setNewMarkets([]);
    try {
      const res = await fetch("/api/markets", { signal });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      const m: ProcessedMarket[] = data.mapped || [];
      const u: ProcessedMarket[] = data.unmapped || [];

      if (m.length > 0 || u.length > 0) {
        setMapped(m);
        setUnmapped(u);
        setDataMode("live");
        setRefreshError(false);
        if (data.lastSync) setLastSyncTime(data.lastSync);

        const sigs = m.filter(
          (item) =>
            item.recentChange !== null &&
            Math.abs(item.recentChange) > 0.05 &&
            !seenSignalIds.current.has(item.id)
        );
        if (sigs.length > 0) {
          for (const s of sigs) seenSignalIds.current.add(s.id);
          setSignals(sigs);
        }

        const all = [...m, ...u];
        if (isFirstLoad.current) {
          for (const item of all) seenMarketIds.current.add(item.id);
          isFirstLoad.current = false;
        } else {
          const fresh = all.filter(
            (item) => !seenMarketIds.current.has(item.id)
          );
          if (fresh.length > 0) {
            for (const item of fresh) seenMarketIds.current.add(item.id);
            setNewMarkets(fresh);
          }
        }
      } else {
        throw new Error("No events in DB");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setRefreshError(true);
      const sample = getSampleData();
      const { mapped: m, unmapped: u } = processEvents(sample);
      setMapped(m);
      setUnmapped(u);
      setDataMode("sample");
    }

    setLastRefresh(new Date().toLocaleTimeString());
    setLoading(false);
  }, []);

  const fetchSmartMoney = useCallback(async (periodOrSignal?: LeaderboardPeriod | AbortSignal, leaderboardOnly?: boolean) => {
    // Support being called from useVisibilityPolling (signal) or directly (period)
    let period: LeaderboardPeriod | undefined;
    let signal: AbortSignal | undefined;
    if (periodOrSignal instanceof AbortSignal) {
      signal = periodOrSignal;
    } else {
      period = periodOrSignal;
    }
    try {
      const sm = useSmartMoneyStore.getState();
      const p = period ?? sm.leaderboardPeriod;
      const params = `period=${p}${leaderboardOnly ? "&leaderboardOnly=1" : ""}`;
      const res = await fetch(`/api/smart-money?${params}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      const lb = data.leaderboard || [];
      lbCacheRef.current[p] = lb;
      sm.setLeaderboard(lb);
      if (!leaderboardOnly) {
        sm.setTrades(data.recentTrades || []);
        sm.setSmartTrades(data.smartTrades || []);
        sm.setLastSync(data.lastSync || null);
      }
    } catch {
      // non-critical
    }
  }, []);

  // Pre-fetch all leaderboard periods into cache on startup
  const lbPrefetchedRef = useRef(false);
  useEffect(() => {
    if (lbPrefetchedRef.current) return;
    lbPrefetchedRef.current = true;
    const periods: LeaderboardPeriod[] = ["day", "week", "month", "all"];
    for (const p of periods) {
      fetch(`/api/smart-money?period=${p}&leaderboardOnly=1`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (data?.leaderboard) lbCacheRef.current[p] = data.leaderboard; })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchSmartMoney();
  }, [fetchData, fetchSmartMoney]);

  // Restore cached selections after data loads (URL param takes priority)
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || (mapped.length === 0 && unmapped.length === 0)) return;
    restoredRef.current = true;
    try {
      // URL ?m= param takes priority over sessionStorage (uses slug)
      const urlParams = new URLSearchParams(window.location.search);
      const urlSlug = urlParams.get("m");
      const cachedSlug = urlSlug || sessionStorage.getItem("pw:selectedMarket");
      const all = [...mapped, ...unmapped];
      let target: ProcessedMarket | undefined;
      if (cachedSlug) {
        target = all.find(m => m.slug === cachedSlug);
      }
      if (!target && all.length > 0) {
        // Fallback to highest impact market
        target = all.reduce((best, m) => (m.impactScore || 0) > (best.impactScore || 0) ? m : best, all[0]);
      }
      if (target) {
        useMarketStore.getState().selectMarket(target);
        if (target.location) useMarketStore.getState().selectCountry(target.location);
      }
      const cachedCountry = sessionStorage.getItem("pw:selectedCountry");
      if (cachedCountry && !useMarketStore.getState().selectedCountry) {
        useMarketStore.getState().selectCountry(cachedCountry);
      }
    } catch {}
  }, [mapped, unmapped]);

  // Visibility-aware polling: pauses when tab is hidden, resumes on visibility
  useVisibilityPolling(fetchData, REFRESH_INTERVAL, autoRefresh);
  useVisibilityPolling(fetchSmartMoney, 30_000, autoRefresh);

  // Alert evaluation on data refresh
  const alertEvalRef = useRef(false);
  const newsCache = useRef<{ items: import("@/types").NewsItem[]; ts: number }>({ items: [], ts: 0 });
  useEffect(() => {
    if (mapped.length === 0 && unmapped.length === 0) return;
    if (!alertEvalRef.current) {
      alertEvalRef.current = true;
      evaluateAlerts([...mapped, ...unmapped], new Set());
      return;
    }
    const freshIds = new Set(newMarkets.map((m) => m.id));
    const allMarkets = [...mapped, ...unmapped];
    const sm = useSmartMoneyStore.getState();
    const signals = detectSignals(sm.trades, allMarkets, 6);

    // Fetch news for news_impact alerts (cached 2min)
    const runEval = (newsItems?: import("@/types").NewsItem[]) => {
      const triggered = evaluateAlerts(allMarkets, freshIds, signals, sm.trades, newsItems);
      for (const t of triggered) {
        sendNotification("PolyWorld Alert", { body: t.message });
      }
    };

    const now = Date.now();
    if (now - newsCache.current.ts < 120_000) {
      runEval(newsCache.current.items);
    } else {
      fetch("/api/news").then((r) => r.ok ? r.json() : []).then((items) => {
        newsCache.current = { items, ts: Date.now() };
        runEval(items);
      }).catch(() => runEval());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapped, unmapped]);

  // Note: isFullscreen is now purely a UI layout toggle (map panel fullscreen),
  // no longer tied to browser fullscreen API.

  const handleFlyTo = useCallback(
    (coords: [number, number], marketId: string) => {
      if (flyToTimer.current) clearTimeout(flyToTimer.current);
      useMarketStore.getState().setFlyToTarget({ coords, marketId });
      flyToTimer.current = setTimeout(() => useMarketStore.getState().setFlyToTarget(null), 3000);
    },
    []
  );

  const handleMarketClick = useCallback((market: ProcessedMarket) => {
    setMobilePreview(null); // dismiss card-triggered popup when map icon is tapped
    const mkt = useMarketStore.getState();
    mkt.selectMarket(market);
    if (market.location) {
      const country = resolveCountryName(market.location)
        || getParentCountry(market.location)
        || market.location;
      mkt.selectCountry(country);
    }
  }, []);

  const handleCountryClick = useCallback((countryName: string) => {
    useMarketStore.getState().selectCountry(countryName);
  }, []);

  // Derived panel locations
  const actualBottomPanelSet = useMemo(() => new Set(bottomPanelOrder), [bottomPanelOrder]);
  const rightVisiblePanels = useMemo(
    () => panelOrder.filter((k) => panelVisibility[k as keyof PanelVisibility] && !actualBottomPanelSet.has(k)),
    [panelOrder, panelVisibility, actualBottomPanelSet]
  );
  const bottomVisiblePanels = useMemo(
    () => bottomPanelOrder.filter((k) => panelVisibility[k as keyof PanelVisibility]),
    [bottomPanelOrder, panelVisibility]
  );

  const handlePanelReorder = useCallback((newOrder: string[]) => {
    useUIStore.getState().setPanelOrder(newOrder);
  }, []);

  const handleBottomReorder = useCallback((newOrder: string[]) => {
    useUIStore.getState().setBottomPanelOrder(newOrder);
  }, []);

  const handlePanelTransfer = useCallback((
    panelId: string,
    fromIdx: number,
    toIdx: number,
    newFrom: string[],
    newTo: string[]
  ) => {
    const { setBottomPanelOrder, setPanelOrder } = useUIStore.getState();
    const setters = [setBottomPanelOrder, setPanelOrder];
    setters[fromIdx](newFrom);
    setters[toIdx](newTo);

    const sourceMaxCols = fromIdx === 0 ? 3 : 2;
    const targetMaxCols = toIdx === 0 ? 3 : 2;
    const requestedSpan = getColSpan(panelId, DEFAULT_COL_SPANS[panelId] ?? 1);
    const currentSpan = Math.max(1, Math.min(requestedSpan, sourceMaxCols));
    const clampedSpan = Math.max(1, Math.min(currentSpan, targetMaxCols));
    if (clampedSpan !== requestedSpan) {
      setColSpan(panelId, clampedSpan);
    }
  }, [getColSpan, setColSpan]);

  const getPanelDragGeometry = useCallback((panelId: string, containerIdx: number) => {
    const maxCols = containerIdx === 0 ? 3 : 2;
    return {
      title: t("panels." + panelId),
      colSpan: Math.max(1, Math.min(getColSpan(panelId, DEFAULT_COL_SPANS[panelId] ?? 1), maxCols)),
      rowSpan: getRowSpan(panelId, 2),
    };
  }, [getColSpan, getRowSpan]);

  const panelDrag = usePanelDrag({
    grids: [
      { droppableId: "panel-grid-bottom", ref: bottomPanelsRef, visibleOrder: bottomVisiblePanels, fullOrder: bottomPanelOrder, onReorder: handleBottomReorder, maxCols: 3 },
      { droppableId: "panel-grid-right", ref: panelsRef, visibleOrder: rightVisiblePanels, fullOrder: panelOrder, onReorder: handlePanelReorder, maxCols: 2 },
    ],
    getPanelGeometry: getPanelDragGeometry,
    onTransfer: handlePanelTransfer,
  });
  const panelCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    return closestCorners(args);
  }, []);
  const panelMeasuring = useMemo(() => ({
    droppable: {
      strategy: MeasuringStrategy.Always,
    },
  }), []);

  const renderBottomVisiblePanels = panelDrag.projectedVisibleOrders?.[0] ?? bottomVisiblePanels;
  const renderRightVisiblePanels = panelDrag.projectedVisibleOrders?.[1] ?? rightVisiblePanels;
  const renderBottomPanelSet = useMemo(() => new Set(renderBottomVisiblePanels), [renderBottomVisiblePanels]);
  const setBottomPanelsNode = useCallback((node: HTMLDivElement | null) => {
    bottomPanelsRef.current = node;
    setBottomDroppableRef(node);
  }, [setBottomDroppableRef]);
  const setRightPanelsNode = useCallback((node: HTMLDivElement | null) => {
    panelsRef.current = node;
    setRightDroppableRef(node);
  }, [setRightDroppableRef]);
  const colSpanFor = useCallback((id: string) => {
    const requested = getColSpan(id, DEFAULT_COL_SPANS[id] ?? 1);
    const maxCols = renderBottomPanelSet.has(id) ? 3 : 2;
    return Math.max(1, Math.min(requested, maxCols));
  }, [getColSpan, renderBottomPanelSet]);
  const panelRenderCacheRef = useRef<Record<string, { signature: string; node: React.ReactElement | null }>>({});

  useEffect(() => {
    if (!panelDrag.isDragging) {
      panelRenderCacheRef.current = {};
    }
  }, [panelDrag.isDragging]);

  // Related markets for detail panel — correlation-based similarity
  const relatedMarkets = useMemo(() => {
    if (!selectedMarket) return [];
    const all = [...mapped, ...unmapped];
    return findSimilarMarkets(selectedMarket, all, 5).map((r) => r.market);
  }, [selectedMarket, mapped, unmapped]);

  const isEnded = useCallback((m: ProcessedMarket) =>
    m.closed || (m.endDate != null && new Date(m.endDate).getTime() < Date.now()), []);

  const timeFiltered = useMemo(() => {
    const active = mapped.filter((m) => !isEnded(m));
    const maxAge = TIME_MAX_AGE[timeRange];
    if (maxAge === 0) return active;
    const cutoff = Date.now() - maxAge;
    return active.filter((m) => m.createdAt && new Date(m.createdAt).getTime() >= cutoff);
  }, [mapped, timeRange, isEnded]);
  const activeMapped = useMemo(() => mapped.filter((m) => !isEnded(m)), [mapped, isEnded]);
  const activeUnmapped = useMemo(() => unmapped.filter((m) => !isEnded(m)), [unmapped, isEnded]);

  const handleSelectMarketFromPanel = useCallback(
    (market: ProcessedMarket) => {
      const mkt = useMarketStore.getState();
      mkt.selectMarket(market);
      if (market.location) {
        const country = resolveCountryName(market.location)
          || getParentCountry(market.location)
          || market.location;
        mkt.selectCountry(country);
      }
      // Mobile: show preview popup + flyTo, detail panel tracks selection in background
      if (window.innerWidth <= 768) {
        setMobilePreview(market);
        if (market.coords) handleFlyTo(market.coords, market.id);
        return;
      }
      if (market.coords) handleFlyTo(market.coords, market.id);
    },
    [handleFlyTo]
  );

  // Stable smart money callbacks
  const handleLeaderboardSelectWallet = useCallback((addr: string) => {
    const sm = useSmartMoneyStore.getState();
    sm.setWalletFilter(addr);
    sm.setTraderPanelWallet(addr);
    const w = sm.leaderboard.find((e) => e.address === addr);
    sm.setTraderWalletName(w?.username || null);
  }, []);

  const handleSmartMoneySelectWallet = useCallback((addr: string) => {
    const sm = useSmartMoneyStore.getState();
    sm.setTraderPanelWallet(addr);
    const t = sm.smartTrades.find((e) => e.wallet === addr);
    sm.setTraderWalletName(t?.username || null);
  }, []);

  const handleWhaleSelectWallet = useCallback((addr: string) => {
    const sm = useSmartMoneyStore.getState();
    sm.setTraderPanelWallet(addr);
    const t = sm.trades.find((e) => e.wallet === addr);
    sm.setTraderWalletName(t?.username || null);
  }, []);

  const handleSmartMoneySelectMarket = useCallback((slug: string) => {
    const all = [...useMarketStore.getState().mapped, ...useMarketStore.getState().unmapped];
    const found = all.find(m => m.slug === slug);
    if (found) handleSelectMarketFromPanel(found);
  }, [handleSelectMarketFromPanel]);

  const [quickTradeModal, setQuickTrade] = useState<TradeModalState | null>(null);

  const handleSignalOpenTrade = useCallback((slug: string, direction: "bullish" | "bearish") => {
    const all = [...useMarketStore.getState().mapped, ...useMarketStore.getState().unmapped];
    const market = all.find(m => m.slug === slug);
    if (!market) return;
    const m = market.markets[0];
    if (!m) return;
    const ids: string[] = m.clobTokenIds
      ? Array.isArray(m.clobTokenIds) ? m.clobTokenIds as string[]
        : (() => { try { return JSON.parse(m.clobTokenIds as unknown as string) as string[]; } catch { return []; } })()
      : [];
    const prices: number[] = m.outcomePrices
      ? Array.isArray(m.outcomePrices)
        ? (m.outcomePrices as string[]).map(Number)
        : (() => { try { return (JSON.parse(m.outcomePrices as unknown as string) as string[]).map(Number); } catch { return []; } })()
      : [];
    const yesTokenId = ids[0] ? String(ids[0]) : "";
    // Use prices[1] directly (not 1 - yesPrice) to handle negRisk markets correctly
    const noTokenId = ids[1] ? String(ids[1]) : "";
    const yesPrice = prices[0] ?? (market.prob ?? 0.5);
    const noPrice = prices[1] ?? (1 - yesPrice);
    const isBullish = direction === "bullish";
    const tokenId = isBullish ? yesTokenId : noTokenId;
    if (!tokenId) return;
    // For multi-outcome markets (>2 tokens), don't expose YES/NO switcher —
    // the signal refers to the event level, not a specific binary pair.
    const isBinary = ids.length === 2;
    setQuickTrade({
      tokenId,
      currentPrice: isBullish ? yesPrice : noPrice,
      outcomeName: isBullish ? "Yes" : "No",
      marketTitle: market.title,
      negRisk: !!market.negRisk,
      defaultSide: "BUY",
      yesToken: isBinary && yesTokenId ? { tokenId: yesTokenId, price: yesPrice, name: "Yes" } : undefined,
      noToken: isBinary && noTokenId ? { tokenId: noTokenId, price: noPrice, name: "No" } : undefined,
      smartMoney: market.smartMoney,
      volume: market.volume,
      volume24h: market.volume24h,
      liquidity: market.liquidity,
      recentChange: market.recentChange,
    });
  }, []);

  const STRENGTH_OPTIONS = useMemo(() => [
    { key: "strong", label: t("common.strong"), color: "#ff4444" },
    { key: "moderate", label: t("common.moderate"), color: "#f59e0b" },
    { key: "weak", label: t("common.weak") },
  ], [t]);
  const CATEGORY_OPTIONS = useMemo(() => [
    { key: "Politics", label: t("categories.Politics") },
    { key: "Crypto", label: t("categories.Crypto") },
    { key: "Sports", label: t("categories.Sports") },
    { key: "Finance", label: t("categories.Finance") },
    { key: "Tech", label: t("categories.Tech") },
    { key: "Culture", label: t("categories.Culture") },
    { key: "Other", label: t("categories.Other") },
  ], [t]);

  function renderPanel(key: string) {
    const maxColSpan = renderBottomPanelSet.has(key) ? 3 : 2;
    switch (key) {
      case "detail":
        return (
          <Panel
            key="detail"
            panelId="detail"
            title={t("panels.detail")}
            badge={selectedMarket ? (
              <span className="panel-data-badge live" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }} onClick={() => useMarketStore.getState().selectMarket(null)} title={t("detail.unselectMarket")}>
                {t("common.selected")}
                <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </span>
            ) : undefined}
            colSpan={colSpanFor("detail")}
            {...panelHandlers["detail"]}
            rowSpan={rowSpanFor("detail")}
            maxColSpan={maxColSpan}
            headerRight={selectedMarket ? (
              <div className="flex items-center gap-1">
                <a
                  href={`https://polymarket.com/event/${encodeURIComponent(selectedMarket.slug)}?via=pw`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 rounded-sm opacity-40 hover:opacity-90 transition-opacity"
                  title={t("detail.viewOnPolymarket")}
                >
                  <img src="/polymarket-icon.png" alt="Polymarket" width={16} height={16} />
                </a>
                <button
                  onClick={() => toggleWatch(selectedMarket.id)}
                  className={`p-1 rounded-sm transition-colors ${
                    isWatched(selectedMarket.id)
                      ? "text-[#f59e0b] hover:bg-[#f59e0b]/10"
                      : "text-[var(--text-dim)] hover:text-[var(--text)]"
                  }`}
                  title={isWatched(selectedMarket.id) ? t("detail.removeFromWatchlist") : t("detail.addToWatchlist")}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill={isWatched(selectedMarket.id) ? "#f59e0b" : "none"} stroke={isWatched(selectedMarket.id) ? "#f59e0b" : "currentColor"} strokeWidth="1.5">
                    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    const ui = useUIStore.getState();
                    ui.setAlertPrefill({ marketId: selectedMarket.id, marketTitle: selectedMarket.title });
                    ui.setAlertManagerOpen(true);
                  }}
                  className="p-1 rounded-sm text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
                  title={t("detail.createAlert")}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </button>
              </div>
            ) : undefined}
          >
            {selectedMarket ? (
              <MarketDetailPanel
                market={selectedMarket}
                relatedMarkets={relatedMarkets}
                onBack={() => useMarketStore.getState().selectMarket(null)}
                onSelectMarket={handleSelectMarketFromPanel}
                onTagClick={(tag) => useUIStore.getState().setMarketSearch(tag)}
              />
            ) : (
              <div className="text-[12px] text-[var(--text-muted)] font-mono">
                {t("detail.clickMarketToView")}
              </div>
            )}
          </Panel>
        );
      case "markets":
        return (
          <MarketsPanel
            key="markets"
            mapped={activeMapped}
            unmapped={activeUnmapped}
            activeCategories={activeCategories}
            onFlyTo={handleFlyTo}
            onSelectMarket={handleSelectMarketFromPanel}
            loading={loading}
            externalSearch={marketSearch}
            isWatched={isWatched}
            onToggleWatch={toggleWatch}
            colSpan={colSpanFor("markets")}
            {...panelHandlers["markets"]}
            rowSpan={rowSpanFor("markets")}
            maxColSpan={maxColSpan}
            selectedMarketId={selectedMarket?.id}
            onTrade={setQuickTrade}
          />
        );
      case "country":
        return (
          <Panel
            key="country"
            panelId="country"
            title={t("panels.country")}
            count={selectedCountry || "\u2014"}
            colSpan={colSpanFor("country")}
            {...panelHandlers["country"]}
            rowSpan={rowSpanFor("country")}
            maxColSpan={maxColSpan}
          >
            {selectedCountry ? (
              <CountryPanel
                countryName={selectedCountry}
                mapped={mapped}
                unmapped={unmapped}
                onSelectMarket={handleSelectMarketFromPanel}
                isWatched={isWatched}
                onToggleWatch={toggleWatch}
              />
            ) : (
              <div className="text-[12px] text-[#777] font-mono">
                {t("detail.clickRegionToView")}
              </div>
            )}
          </Panel>
        );
      case "news": {
        const newsMarket = newsFollowMarket ? selectedMarket : null;
        return (
          <Panel
            key="news"
            panelId="news"
            title={t("panels.news")}
            className="panel-news"
            colSpan={colSpanFor("news")}
            {...panelHandlers["news"]}
            rowSpan={rowSpanFor("news")}
            maxColSpan={maxColSpan}
            headerRight={
              <span className="flex items-center gap-1.5">
                <FilterDropdown
                  label={t("common.source")}
                  groups={[{
                    label: t("common.source"),
                    options: newsActiveSources.map(s => ({ key: s, label: s })),
                    selected: newsSourceFilter,
                    onChange: setNewsSourceFilter,
                  }]}
                />
                {selectedMarket && (
                  <button
                    onClick={() => setNewsFollowMarket((v) => !v)}
                    className={`shrink-0 transition-colors leading-none ${newsFollowMarket ? "text-[var(--green)]" : "text-[var(--text-ghost)] hover:text-[var(--text)]"}`}
                    title={newsFollowMarket ? t("news.unlinkFromMarket") : t("news.followMarket")}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {newsFollowMarket
                        ? <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        : <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /><line x1="4" y1="4" x2="20" y2="20" strokeWidth="2.5" /></>
                      }
                    </svg>
                  </button>
                )}
              </span>
            }
          >
            <NewsPanel selectedMarket={newsMarket} sourceFilter={newsSourceFilter} onSourcesChange={setNewsActiveSources} />
          </Panel>
        );
      }
      case "tweets": {
        const tweetsMarket = tweetsFollowMarket ? selectedMarket : null;
        return (
          <Panel
            key="tweets"
            panelId="tweets"
            title={t("panels.tweets")}
            className="panel-tweets"
            colSpan={colSpanFor("tweets")}
            {...panelHandlers["tweets"]}
            rowSpan={rowSpanFor("tweets")}
            maxColSpan={maxColSpan}
            headerRight={
              <span className="flex items-center gap-1.5">
                <FilterDropdown
                  label={t("common.account")}
                  groups={[{
                    label: t("common.account"),
                    options: tweetsActiveHandles.map(h => ({ key: h, label: `@${h}` })),
                    selected: tweetsHandleFilter,
                    onChange: setTweetsHandleFilter,
                  }]}
                />
                {selectedMarket && (
                  <button
                    onClick={() => setTweetsFollowMarket((v) => !v)}
                    className={`shrink-0 transition-colors leading-none ${tweetsFollowMarket ? "text-[var(--green)]" : "text-[var(--text-ghost)] hover:text-[var(--text)]"}`}
                    title={tweetsFollowMarket ? t("news.unlinkFromMarket") : t("news.followMarket")}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {tweetsFollowMarket
                        ? <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        : <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /><line x1="4" y1="4" x2="20" y2="20" strokeWidth="2.5" /></>
                      }
                    </svg>
                  </button>
                )}
              </span>
            }
          >
            <TweetsPanel selectedMarket={tweetsMarket} handleFilter={tweetsHandleFilter} onHandlesChange={setTweetsActiveHandles} />
          </Panel>
        );
      }
      case "live":
        return (
          <Panel
            key="live"
            panelId="live"
            title={t("panels.live")}
            className="panel-live"
            badge={<span className="panel-data-badge live">{t("common.live")}</span>}
            headerRight={
              <LiveChannelDropdown
                activeStream={liveActiveStream}
                onSelect={setLiveActiveStream}
              />
            }
            colSpan={colSpanFor("live")}
            {...panelHandlers["live"]}
            rowSpan={rowSpanFor("live")}
            maxColSpan={maxColSpan}
          >
            <LivePanel activeStream={liveActiveStream} />
          </Panel>
        );
      case "watchlist":
        return (
          <Panel
            key="watchlist"
            panelId="watchlist"
            title={t("panels.watchlist")}
            colSpan={colSpanFor("watchlist")}
            {...panelHandlers["watchlist"]}
            rowSpan={rowSpanFor("watchlist")}
            maxColSpan={maxColSpan}
            headerRight={
              watchedCount > 0 ? (
                <span className="text-[10px] text-[var(--text-muted)] font-mono">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" strokeWidth="1.5" className="inline -mt-px mr-0.5">
                    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                  </svg>
                  {t("watchlistPanel.watched", { count: watchedCount })}
                </span>
              ) : undefined
            }
          >
            <WatchlistPanel
              watchedIds={watchedIds}
              mapped={mapped}
              unmapped={unmapped}
              addedAt={addedAt}
              onSelectMarket={handleSelectMarketFromPanel}
              isWatched={isWatched}
              onToggleWatch={toggleWatch}
              onTrade={setQuickTrade}
            />
          </Panel>
        );
      case "leaderboard":
        return (
          <Panel
            key="leaderboard"
            panelId="leaderboard"
            title={t("panels.leaderboard")}
            count={smartMoneyLeaderboard.length > 0 ? `${smartMoneyLeaderboard.length}` : undefined}
            colSpan={colSpanFor("leaderboard")}
            {...panelHandlers["leaderboard"]}
            rowSpan={rowSpanFor("leaderboard")}
            maxColSpan={maxColSpan}
            headerRight={
              <div className="flex gap-0.5">
                {(["day", "week", "month", "all"] as LeaderboardPeriod[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      const sm = useSmartMoneyStore.getState();
                      sm.setLeaderboardPeriod(p);
                      const cached = lbCacheRef.current[p];
                      if (cached) sm.setLeaderboard(cached);
                      else fetchSmartMoney(p, true);
                    }}
                    className="px-1.5 py-0 text-[9px] rounded transition-colors leading-[18px]"
                    style={{
                      background: leaderboardPeriod === p ? "rgba(34,197,94,0.15)" : "transparent",
                      color: leaderboardPeriod === p ? "#22c55e" : "var(--text-faint)",
                      border: `1px solid ${leaderboardPeriod === p ? "rgba(34,197,94,0.3)" : "transparent"}`,
                    }}
                  >
                    {p === "day" ? "D" : p === "week" ? "W" : p === "month" ? "M" : "ALL"}
                  </button>
                ))}
              </div>
            }
          >
            <LeaderboardPanel
              leaderboard={smartMoneyLeaderboard}
              onSelectWallet={handleLeaderboardSelectWallet}
            />
          </Panel>
        );
      case "smartMoney":
        return (
          <Panel
            key="smartMoney"
            panelId="smartMoney"
            title={t("panels.smartTrades")}
            badge={
              smartMoneySmartTrades.length > 0 ? (
                <span className="panel-data-badge live">
                  {smartMoneySmartTrades.length} {t("smartMoney.smart")}
                </span>
              ) : undefined
            }
            colSpan={colSpanFor("smartMoney")}
            {...panelHandlers["smartMoney"]}
            rowSpan={rowSpanFor("smartMoney")}
            maxColSpan={maxColSpan}
          >
            <SmartMoneyPanel
              smartTrades={smartMoneySmartTrades}
              markets={[...mapped, ...unmapped]}
              walletFilter={smartWalletFilter}
              onClearFilter={() => useSmartMoneyStore.getState().setWalletFilter(null)}
              onSelectWallet={handleSmartMoneySelectWallet}
              onSelectMarket={handleSmartMoneySelectMarket}
            />
          </Panel>
        );
      case "whaleTrades":
        return (
          <Panel
            key="whaleTrades"
            panelId="whaleTrades"
            title={t("panels.whaleTrades")}
            badge={
              smartMoneyTrades.length > 0 ? (
                <span className="panel-data-badge">
                  {smartMoneyTrades.length}
                </span>
              ) : undefined
            }
            colSpan={colSpanFor("whaleTrades")}
            {...panelHandlers["whaleTrades"]}
            rowSpan={rowSpanFor("whaleTrades")}
            maxColSpan={maxColSpan}
          >
            <WhaleTradesPanel
              trades={smartMoneyTrades}
              onSelectWallet={handleWhaleSelectWallet}
              onSelectMarket={handleSmartMoneySelectMarket}
            />
          </Panel>
        );
      case "orderbook":
        return (
          <Panel
            key="orderbook"
            panelId="orderbook"
            title={t("panels.orderbook")}
            badge={selectedMarket && !selectedMarket.closed ? <span className="panel-data-badge live">{t("common.live")}</span> : undefined}
            colSpan={colSpanFor("orderbook")}
            {...panelHandlers["orderbook"]}
            rowSpan={rowSpanFor("orderbook")}
            maxColSpan={maxColSpan}
            headerRight={
              selectedMarket ? (
                <span className="text-[10px] font-mono truncate max-w-[200px] text-[var(--text-dim)]" title={orderbookOutcomeName ?? defaultOrderbookOutcomeName ?? selectedMarket.title}>
                  {orderbookOutcomeName ?? defaultOrderbookOutcomeName ?? selectedMarket.title}
                </span>
              ) : undefined
            }
          >
            <OrderBookPanel selectedMarket={selectedMarket} />
          </Panel>
        );
      case "trader": {
        const handleTraderGo = () => {
          const addr = traderAddrInput.trim();
          if (/^0x[a-fA-F0-9]{40}$/i.test(addr)) {
            const sm = useSmartMoneyStore.getState();
            sm.setTraderPanelWallet(addr);
            sm.setTraderWalletName(null);
            sm.setTraderAddrInput("");
          }
        };
        return (
          <Panel
            key="trader"
            panelId="trader"
            title={t("panels.trader")}
            colSpan={colSpanFor("trader")}
            {...panelHandlers["trader"]}
            rowSpan={rowSpanFor("trader")}
            maxColSpan={maxColSpan}
            headerRight={
              <div className="flex items-center gap-1">
                {traderPrefsReady && traderPanelWallet ? (
                  <>
                    <span className="text-[10px] font-mono text-[var(--text-dim)]" title={traderPanelWallet}>
                      {traderWalletName || `${traderPanelWallet.slice(0, 6)}\u2026${traderPanelWallet.slice(-4)}`}
                    </span>
                    <button
                      onClick={() => { const sm = useSmartMoneyStore.getState(); sm.setTraderPanelWallet(null); sm.setTraderWalletName(null); }}
                      className="text-[10px] text-[var(--text-ghost)] hover:text-[var(--text)] transition-colors"
                      title={t("traderPanel.clearTrader")}
                    >
                      &times;
                    </button>
                  </>
                ) : null}
                <input
                  className="w-[100px] bg-[var(--bg-panel)] border border-[var(--border)] rounded-sm px-1 py-0 text-[10px] text-[var(--text)] font-mono placeholder:text-[var(--text-ghost)] leading-[18px]"
                  placeholder="0x\u2026"
                  value={traderAddrInput}
                  onChange={(e) => useSmartMoneyStore.getState().setTraderAddrInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTraderGo()}
                />
                <button
                  onClick={handleTraderGo}
                  className="px-1 py-0 border border-[var(--border)] rounded-sm text-[9px] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)] transition-colors leading-[18px]"
                >
                  {t("wallet.go")}
                </button>
              </div>
            }
          >
            <TraderPanel
              selectedWallet={traderPrefsReady ? traderPanelWallet : null}
            />
          </Panel>
        );
      }
      case "sentiment":
        return (
          <Panel
            key="sentiment"
            panelId="sentiment"
            title={t("panels.sentiment")}
            colSpan={colSpanFor("sentiment")}
            {...panelHandlers["sentiment"]}
            rowSpan={rowSpanFor("sentiment")}
            maxColSpan={maxColSpan}
          >
            <SentimentPanel />
          </Panel>
        );
      case "chart":
        return (
          <Panel
            key="chart"
            panelId="chart"
            title={t("panels.chart")}
            colSpan={colSpanFor("chart")}
            {...panelHandlers["chart"]}
            rowSpan={rowSpanFor("chart")}
            maxColSpan={maxColSpan}
            headerRight={
              selectedMarket ? (
                <span className="text-[10px] font-mono truncate max-w-[200px] text-[var(--text-dim)]" title={selectedMarket.title}>
                  {selectedMarket.title}
                </span>
              ) : undefined
            }
          >
            <ChartPanel selectedMarket={selectedMarket} />
          </Panel>
        );
      case "arbitrage":
        return (
          <Panel
            key="arbitrage"
            panelId="arbitrage"
            title={t("panels.arbitrage")}
            colSpan={colSpanFor("arbitrage")}
            {...panelHandlers["arbitrage"]}
            rowSpan={rowSpanFor("arbitrage")}
            maxColSpan={maxColSpan}
          >
            <ArbitragePanel
              markets={[...mapped, ...unmapped]}
              onSelectMarket={handleSmartMoneySelectMarket}
            />
          </Panel>
        );
      case "calendar":
        return (
          <Panel
            key="calendar"
            panelId="calendar"
            title={t("panels.calendar")}
            colSpan={colSpanFor("calendar")}
            {...panelHandlers["calendar"]}
            rowSpan={rowSpanFor("calendar")}
            maxColSpan={maxColSpan}
          >
            <CalendarPanel
              markets={[...mapped, ...unmapped]}
              onSelectMarket={handleSmartMoneySelectMarket}
            />
          </Panel>
        );
      case "signals":
        return (
          <Panel
            key="signals"
            panelId="signals"
            title={t("panels.signals")}
            colSpan={colSpanFor("signals")}
            {...panelHandlers["signals"]}
            rowSpan={rowSpanFor("signals")}
            maxColSpan={maxColSpan}
            headerRight={
              <FilterDropdown groups={[
                { label: t("common.strength"), options: STRENGTH_OPTIONS, selected: sigStrFilter, onChange: setSigStrFilter },
                { label: t("common.category"), options: CATEGORY_OPTIONS, selected: sigCatFilter, onChange: setSigCatFilter },
              ]} />
            }
          >
            <SignalPanel
              trades={smartMoneyTrades}
              markets={[...mapped, ...unmapped]}
              leaderboard={smartMoneyLeaderboard}
              onSelectWallet={handleSmartMoneySelectWallet}
              onSelectMarket={handleSmartMoneySelectMarket}
              onOpenTrade={handleSignalOpenTrade}
              categoryFilter={sigCatFilter}
              strengthFilter={sigStrFilter}
              onTrade={setQuickTrade}
            />
          </Panel>
        );
      case "resolution":
        return (
          <Panel
            key="resolution"
            panelId="resolution"
            title={t("panels.resolution")}
            colSpan={colSpanFor("resolution")}
            {...panelHandlers["resolution"]}
            rowSpan={rowSpanFor("resolution")}
            maxColSpan={maxColSpan}
            headerRight={
              <FilterDropdown groups={[
                { label: t("common.strength"), options: STRENGTH_OPTIONS, selected: resStrFilter, onChange: setResStrFilter },
                { label: t("common.category"), options: CATEGORY_OPTIONS, selected: resCatFilter, onChange: setResCatFilter },
              ]} />
            }
          >
            <ResolutionPanel
              onSelectMarket={handleSmartMoneySelectMarket}
              categoryFilter={resCatFilter}
              strengthFilter={resStrFilter}
            />
          </Panel>
        );
      case "portfolio":
        return (
          <Panel
            key="portfolio"
            panelId="portfolio"
            title={t("panels.portfolio")}
            colSpan={colSpanFor("portfolio")}
            {...panelHandlers["portfolio"]}
            rowSpan={rowSpanFor("portfolio")}
            maxColSpan={maxColSpan}
          >
            <PortfolioPanel
              markets={[...mapped, ...unmapped]}
              onSelectMarket={handleSmartMoneySelectMarket}
            />
          </Panel>
        );
      case "openOrders":
        return (
          <Panel
            key="openOrders"
            panelId="openOrders"
            title={t("panels.openOrders")}
            colSpan={colSpanFor("openOrders")}
            {...panelHandlers["openOrders"]}
            rowSpan={rowSpanFor("openOrders")}
            maxColSpan={maxColSpan}
          >
            <OpenOrdersPanel
              markets={[...mapped, ...unmapped]}
              onSelectMarket={handleSmartMoneySelectMarket}
            />
          </Panel>
        );
      default:
        return null;
    }
  }

  function renderDesktopPanel(key: string) {
    const cacheSignature = `${renderBottomPanelSet.has(key) ? "bottom" : "right"}:${colSpanFor(key)}:${rowSpanFor(key)}`;
    return (
      <DraggablePanelItem id={key} disableTransforms={panelDrag.isDragging || panelDrag.disableTransforms}>
        {panelDrag.activeId === key ? (
          <PanelDropPreview
            panelId={key}
            title={t("panels." + key)}
            colSpan={colSpanFor(key)}
            rowSpan={rowSpanFor(key)}
          />
        ) : (
          (() => {
            const cached = panelRenderCacheRef.current[key];
            if (panelDrag.isDragging && cached?.signature === cacheSignature) return cached.node;
            const node = renderPanel(key);
            panelRenderCacheRef.current[key] = {
              signature: cacheSignature,
              node,
            };
            return node;
          })()
        )}
      </DraggablePanelItem>
    );
  }

  return (
    <div id="app-root">
      <Header
        lastRefresh={lastRefresh}
        dataMode={dataMode}
        loading={loading}
        onRefresh={fetchData}
        marketCount={mapped.length}
        globalCount={unmapped.length}
        lastSyncTime={lastSyncTime}
        onOpenSettings={() => useUIStore.getState().setSettingsOpen(true)}
        watchedCount={watchedCount}
        alertUnreadCount={unreadCount}
        autoRefresh={autoRefresh}
        refreshError={refreshError}
        onTrade={setQuickTrade}
        onTradePosition={(positionTitle, outcome) => {
          // Match position to market by title (conditionId formats don't align)
          const allMarkets = [...mapped, ...unmapped];
          const needle = positionTitle.toLowerCase().trim();
          const outcomeNeedle = outcome.toLowerCase().trim();
          for (const ev of allMarkets) {
            // Match against event title or sub-market question
            const evMatch = ev.title.toLowerCase().trim() === needle;
            for (const m of ev.markets) {
              const mMatch = evMatch || (m.question || m.groupItemTitle || "").toLowerCase().trim() === needle;
              if (!mMatch) continue;
              // For multi-outcome events, also match the specific sub-market by groupItemTitle
              if (evMatch && ev.markets.length > 1 && m.groupItemTitle) {
                const optionLabel = m.groupItemTitle.toLowerCase().trim();
                // outcome could be "No change", "No change No", or plain "Yes"/"No"
                if (optionLabel !== outcomeNeedle && !outcomeNeedle.startsWith(optionLabel)) continue;
              }
              const ids = (() => {
                if (!m.clobTokenIds) return [];
                if (Array.isArray(m.clobTokenIds)) return m.clobTokenIds as string[];
                try { return JSON.parse(m.clobTokenIds as string) as string[]; } catch { return []; }
              })();
              const prices = (() => {
                if (!m.outcomePrices) return [];
                const raw = Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices as string);
                return raw.map((p: string) => parseFloat(p));
              })();
              if (ids.length >= 2) {
                const yesTokenId = String(ids[0]);
                const noTokenId = String(ids[1]);
                const yesPrice = prices[0] ?? ev.prob ?? 0.5;
                const noPrice = prices[1] ?? (1 - yesPrice);
                // "No" or outcome ending with " No" (e.g. "No change No") → pick No token
                const isNo = outcomeNeedle === "no" || outcomeNeedle.endsWith(" no");
                const optionName = m.groupItemTitle || m.question || "";
                const yesLabel = optionName || "Yes";
                const noLabel = optionName ? `${optionName} No` : "No";
                setQuickTrade({
                  tokenId: isNo ? noTokenId : yesTokenId,
                  currentPrice: isNo ? noPrice : yesPrice,
                  outcomeName: isNo ? noLabel : yesLabel,
                  marketTitle: ev.title,
                  negRisk: !!ev.negRisk,
                  defaultSide: "SELL",
                  yesToken: { tokenId: yesTokenId, price: yesPrice, name: yesLabel },
                  noToken: { tokenId: noTokenId, price: noPrice, name: noLabel },
                  smartMoney: ev.smartMoney,
                  volume: ev.volume,
                  volume24h: ev.volume24h,
                  liquidity: ev.liquidity,
                  recentChange: ev.recentChange,
                });
                return;
              }
            }
          }
        }}
        alertManagerOpen={alertManagerOpen}
        onOpenAlertManager={() => useUIStore.getState().setAlertManagerOpen((v) => !v)}
        onCloseAlertManager={() => { const ui = useUIStore.getState(); ui.setAlertManagerOpen(false); ui.setAlertPrefill(undefined); }}
        alertProps={{
          alerts,
          history: alertHistory,
          onAddAlert: addAlert,
          onRemoveAlert: removeAlert,
          onToggleAlert: toggleAlert,
          onMarkRead: markRead,
          onMarkAllRead: markAllRead,
          onClearHistory: clearHistory,
          allMarkets: [...mapped, ...unmapped],
          prefill: alertPrefill,
          notifPermission,
          onRequestPermission: requestPermission,
        }}
      />

      <DndContext
        id={dndId}
        sensors={panelDrag.sensors}
        collisionDetection={panelCollisionDetection}
        measuring={panelMeasuring}
        onDragStart={panelDrag.onDragStart}
        onDragMove={panelDrag.onDragMove}
        onDragOver={panelDrag.onDragOver}
        onDragEnd={panelDrag.onDragEnd}
        onDragCancel={panelDrag.onDragCancel}
        autoScroll={{ enabled: true, layoutShiftCompensation: false }}
      >
      <div className="main-content" ref={mainRef} style={{ gridTemplateColumns: isFullscreen ? "1fr" : `${mapWidthPct}% 6px 1fr` } as React.CSSProperties}>
        {/* Map section */}
        <div className="map-section" ref={mapSectionRef}>
          <div className="map-panel-header">
            <span className="panel-title">{t("panels.worldMap")}</span>
            <span className="panel-count">{timeFiltered.length} {t("common.markets")}</span>
            <div className="flex-1" />
            <button
              onClick={() => useUIStore.getState().setIsFullscreen(!isFullscreen)}
              className="panel-expand-btn"
              title={isFullscreen ? t("exitMapFullscreen") : t("mapFullscreen")}
            >
              <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                {isFullscreen ? (
                  <>
                    <path d="M5 1v4H1" /><path d="M9 1v4h4" />
                    <path d="M5 13V9H1" /><path d="M9 13V9h4" />
                  </>
                ) : (
                  <>
                    <path d="M1 5V1h4" /><path d="M13 5V1H9" />
                    <path d="M1 9v4h4" /><path d="M13 9v4H9" />
                  </>
                )}
              </svg>
            </button>
          </div>
          <div className="map-container">
            <WorldMap
              markets={timeFiltered}
              activeCategories={activeCategories}
              flyToTarget={flyToTarget}
              timeRange={timeRange}
              onTimeRangeChange={setTimeRange}
              onToggleCategory={toggleCategory}
              onToggleFullscreen={toggleFullscreen}
              isFullscreen={isFullscreen}
              onMarketClick={handleMarketClick}
              onCountryClick={handleCountryClick}
              selectedCountry={selectedCountry}
              selectedMarketId={selectedMarket?.id ?? null}
              colorMode={colorMode}
              onColorModeChange={setColorMode}
              region={region}
              onRegionChange={setRegion}
              isWatched={isWatched}
              onToggleWatch={toggleWatch}
              newMarkets={newMarkets}
              whaleTrades={smartMoneyTrades}
              activeLayers={activeLayers}
              onToggleLayer={toggleOverlayLayer}
              onTrade={setQuickTrade}
              onMapTap={() => setMobilePreview(null)}
            />
          </div>
          {/* Horizontal resize handle + bottom panels (hidden in map fullscreen) */}
          {!isFullscreen && (
            <>
              <ResizeHandle direction="horizontal" onResize={handleHorizontalResize} />
              {!bottomPanelCollapsed && (
                <div
                  className={`bottom-panels-grid${renderBottomVisiblePanels.length === 0 ? " bottom-panels-grid-empty" : ""}`}
                  ref={setBottomPanelsNode}
                  style={renderBottomVisiblePanels.length > 0 ? { height: bottomPanelHeight } : undefined}
                >
                  <SortableContext items={renderBottomVisiblePanels} strategy={rectSortingStrategy}>
                    {renderBottomVisiblePanels.map((key) => (
                      <PanelErrorBoundary key={`eb-${key}`} panelName={key}>
                        {renderDesktopPanel(key)}
                      </PanelErrorBoundary>
                    ))}
                  </SortableContext>
                </div>
              )}
            </>
          )}
        </div>

        {/* Vertical resize handle + right panels (hidden in map fullscreen) */}
        {!isFullscreen && !isMobile && (
          <>
            <ResizeHandle direction="vertical" onResize={handleVerticalResize} />
            <div className="panels-grid" ref={setRightPanelsNode}>
              <SortableContext items={renderRightVisiblePanels} strategy={rectSortingStrategy}>
                {renderRightVisiblePanels.map((key) => (
                  <PanelErrorBoundary key={`eb-${key}`} panelName={key}>
                    {renderDesktopPanel(key)}
                  </PanelErrorBoundary>
                ))}
              </SortableContext>
            </div>
          </>
        )}

        {/* Mobile: single panel fullscreen view */}
        {!isFullscreen && isMobile && activeMobilePanel && (
          <div
            className="mobile-panel-view"
            ref={panelsRef}
            onTouchStart={(e) => {
              (e.currentTarget as HTMLDivElement).dataset.touchStartY = String(e.touches[0].clientY);
            }}
            onTouchEnd={(e) => {
              const startY = Number((e.currentTarget as HTMLDivElement).dataset.touchStartY || 0);
              const endY = e.changedTouches[0].clientY;
              if (endY - startY > 80 && e.currentTarget.scrollTop <= 0) {
                useUIStore.getState().setActiveMobilePanel(null);
              }
            }}
          >
            <PanelErrorBoundary panelName={activeMobilePanel}>
              {renderPanel(activeMobilePanel)}
            </PanelErrorBoundary>
          </div>
        )}
      </div>
      <DragOverlay
        adjustScale={false}
        dropAnimation={null}
        modifiers={panelDrag.overlayModifiers}
        zIndex={9999}
      >
        {panelDrag.overlay ? <PanelDragOverlay {...panelDrag.overlay} /> : null}
      </DragOverlay>
      </DndContext>

      {/* Mobile market preview popup — shown over the map area, pointer-events pass through to map */}
      {isMobile && mobilePreview && (
        <div
          className="fixed max-h-[50dvh] overflow-y-auto bg-[var(--bg)] border border-[var(--border)] rounded-md z-[9998]"
          style={{
            width: Math.min(300, window.innerWidth - 16),
            left: "50%",
            transform: "translateX(-50%)",
            top: 48,
            padding: "12px 14px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
          }}
        >
          <Suspense fallback={<div className="text-[12px] text-[var(--text-faint)] font-mono py-4">loading...</div>}>
            <MarketPreview market={mobilePreview} onTrade={setQuickTrade} hideChart />
          </Suspense>
        </div>
      )}

      {/* Mobile bottom tab bar */}
      {isMobile && (
        <MobileTabBar
          activePanel={activeMobilePanel}
          onSelect={(panel) => useUIStore.getState().setActiveMobilePanel(
            panel === "map" ? null : panel
          )}
        />
      )}

      {!isMobile && <Footer />}

      {settingsOpen && (
        <SettingsModal
          open={settingsOpen}
          onClose={() => useUIStore.getState().setSettingsOpen(false)}
          activeCategories={activeCategories}
          onToggleCategory={toggleCategory}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={() => useUIStore.getState().setAutoRefresh((prev) => !prev)}
          panelVisibility={panelVisibility}
          onTogglePanelVisibility={togglePanelVisibility}
          dataMode={dataMode}
          lastSyncTime={lastSyncTime}
          marketCount={mapped.length}
          globalCount={unmapped.length}
        />
      )}


      <OnboardingModal />
      <ToastContainer onSelectMarket={handleSelectMarketFromPanel} />
      {quickTradeModal && (
        <TradeModal state={quickTradeModal} onClose={() => setQuickTrade(null)} />
      )}
    </div>
  );
}

const MOBILE_TABS: Array<{ id: string; labelKey: string; icon: string }> = [
  { id: "map", labelKey: "mobile.map", icon: "\uD83C\uDF0D" },
  { id: "markets", labelKey: "mobile.markets", icon: "\uD83D\uDCC8" },
  { id: "watchlist", labelKey: "mobile.watch", icon: "\u2B50" },
  { id: "detail", labelKey: "mobile.detail", icon: "\uD83D\uDCCA" },
  { id: "more", labelKey: "mobile.more", icon: "\u2026" },
];

const MORE_PANELS = ["news", "smartMoney", "country", "tweets", "live", "leaderboard", "whaleTrades", "orderbook", "trader", "sentiment", "chart", "signals", "resolution", "portfolio", "arbitrage", "calendar"];

function MobileTabBar({ activePanel, onSelect }: { activePanel: string | null; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  const [showMore, setShowMore] = useState(false);

  // Detect browser bottom toolbar (Chrome Android etc.) via visualViewport
  useEffect(() => {
    const update = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const bottomBar = window.innerHeight - vv.height - vv.offsetTop;
      document.documentElement.style.setProperty(
        "--browser-bottom-bar",
        bottomBar > 0 ? `${bottomBar}px` : "0px"
      );
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    return () => window.visualViewport?.removeEventListener("resize", update);
  }, []);

  return (
    <>
      {/* "More" dropdown */}
      {showMore && (
        <div className="mobile-more-menu">
          {MORE_PANELS.map((id) => (
            <button
              key={id}
              onClick={() => { onSelect(id); setShowMore(false); }}
              className={`mobile-more-item${activePanel === id ? " active" : ""}`}
            >
              {t("panels." + id)}
            </button>
          ))}
        </div>
      )}
      <nav className="mobile-tab-bar">
        {MOBILE_TABS.map((tab) => {
          const isActive = tab.id === "map"
            ? activePanel === null
            : tab.id === "more"
            ? MORE_PANELS.includes(activePanel || "")
            : activePanel === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === "more") {
                  setShowMore((v) => !v);
                } else if (tab.id === "map") {
                  onSelect("map");
                  setShowMore(false);
                } else if (activePanel === tab.id) {
                  // Toggle: tap active tab again → return to map
                  onSelect("map");
                  setShowMore(false);
                } else {
                  onSelect(tab.id);
                  setShowMore(false);
                }
              }}
              className={`mobile-tab${isActive ? " active" : ""}`}
            >
              <span className="mobile-tab-icon">{tab.icon}</span>
              <span className="mobile-tab-label">{t(tab.labelKey)}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
