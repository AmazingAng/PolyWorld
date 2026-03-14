"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { ProcessedMarket, Category } from "@/types";
import { processEvents, getSampleData } from "@/lib/polymarket";
import { findSimilarMarkets } from "@/lib/correlation";
import Header from "@/components/Header";
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
import ResolutionPanel from "@/components/ResolutionPanel";
import PortfolioPanel from "@/components/PortfolioPanel";
import FilterDropdown from "@/components/FilterDropdown";
import { detectSignals } from "@/lib/smartSignals";
import PanelErrorBoundary from "@/components/PanelErrorBoundary";
import { usePanelColSpans } from "@/hooks/usePanelColSpans";
import { usePanelRowSpans } from "@/hooks/usePanelRowSpans";
import { useMarketStore } from "@/stores/marketStore";
import { useSmartMoneyStore } from "@/stores/smartMoneyStore";
import { useUIStore } from "@/stores/uiStore";

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
  markets: 1, country: 1, news: 1, tweets: 1, live: 1, watchlist: 1, detail: 2, leaderboard: 1, trader: 1, smartMoney: 1, whaleTrades: 1, orderbook: 1, sentiment: 1, chart: 1, arbitrage: 1, calendar: 1, signals: 1, resolution: 1, portfolio: 1,
};

// Time range → max age in milliseconds (0 = no filter)
const TIME_MAX_AGE: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "48h": 48 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  ALL: 0,
};

export default function Home() {
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
  const selectedMarket = useMarketStore((s) => s.selectedMarket);
  const selectedCountry = useMarketStore((s) => s.selectedCountry);
  const flyToTarget = useMarketStore((s) => s.flyToTarget);

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
  const isDragging = useUIStore((s) => s.isDragging);
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
  const setIsDragging = useUIStore((s) => s.setIsDragging);
  const setTimeRange = useUIStore((s) => s.setTimeRange);
  const toggleCategory = useUIStore((s) => s.toggleCategory);
  const toggleFullscreen = useUIStore((s) => s.toggleFullscreen);
  const setColorMode = useUIStore((s) => s.setColorMode);
  const setRegion = useUIStore((s) => s.setRegion);
  const togglePanelVisibility = useUIStore((s) => s.togglePanelVisibility);

  // ─── Panel filter state ───
  const [sigStrFilter, setSigStrFilter] = useState<Set<string>>(new Set());
  const [sigCatFilter, setSigCatFilter] = useState<Set<string>>(new Set());
  const [resStrFilter, setResStrFilter] = useState<Set<string>>(new Set());
  const [resCatFilter, setResCatFilter] = useState<Set<string>>(new Set());
  const [newsCleared, setNewsCleared] = useState(false);
  const [tweetsCleared, setTweetsCleared] = useState(false);
  const [liveActiveStream, setLiveActiveStream] = useState<StreamSource | null>(null);

  // Reset per-panel market overrides when a new market is selected
  useEffect(() => { setNewsCleared(false); setTweetsCleared(false); }, [selectedMarket]);

  const panelsRef = useRef<HTMLDivElement>(null);
  const bottomPanelsRef = useRef<HTMLDivElement>(null);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 768px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Watchlist
  const { watchedIds, isWatched, toggleWatch, count: watchedCount, addedAt } = useWatchlist();
  const { getColSpan, setColSpan, resetColSpan } = usePanelColSpans();
  const colSpanFor = (id: string) => getColSpan(id, DEFAULT_COL_SPANS[id] ?? 1);
  const { getRowSpan, setRowSpan, resetRowSpan } = usePanelRowSpans();
  const rowSpanFor = (id: string) => getRowSpan(id, 2);

  // Pre-generate stable handler objects for all panels (avoids inline arrow functions in renderPanel)
  const panelHandlers = useMemo(() => {
    const ids = ["detail", "markets", "country", "news", "tweets", "live", "watchlist", "leaderboard", "smartMoney", "whaleTrades", "orderbook", "trader", "sentiment", "chart", "arbitrage", "calendar", "signals", "resolution", "portfolio"];
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

  const handlePanelReorder = useCallback((newOrder: string[]) => {
    useUIStore.getState().setPanelOrder(newOrder);
  }, []);

  const handleBottomReorder = useCallback((newOrder: string[]) => {
    useUIStore.getState().setBottomPanelOrder(newOrder);
  }, []);

  const handlePanelTransfer = useCallback((
    _panelId: string,
    fromIdx: number,
    toIdx: number,
    newFrom: string[],
    newTo: string[]
  ) => {
    const { setBottomPanelOrder, setPanelOrder } = useUIStore.getState();
    const setters = [setBottomPanelOrder, setPanelOrder];
    setters[fromIdx](newFrom);
    setters[toIdx](newTo);
  }, []);

  usePanelDrag({
    grids: [
      { ref: bottomPanelsRef, panelOrder: bottomPanelOrder, onReorder: handleBottomReorder },
      { ref: panelsRef, panelOrder: panelOrder, onReorder: handlePanelReorder },
    ],
    onTransfer: handlePanelTransfer,
    onDragStateChange: setIsDragging,
  });

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

  const fetchData = useCallback(async () => {
    const { setMapped, setUnmapped, setLoading, setDataMode, setLastSyncTime, setSignals, setNewMarkets, setLastRefresh } = useMarketStore.getState();
    setLoading(true);
    setNewMarkets([]);
    try {
      const res = await fetch("/api/markets");
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
    } catch {
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

  const fetchSmartMoney = useCallback(async (period?: LeaderboardPeriod, leaderboardOnly?: boolean) => {
    try {
      const sm = useSmartMoneyStore.getState();
      const p = period ?? sm.leaderboardPeriod;
      const params = `period=${p}${leaderboardOnly ? "&leaderboardOnly=1" : ""}`;
      const res = await fetch(`/api/smart-money?${params}`);
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
      // URL ?m= param takes priority over sessionStorage
      const urlParams = new URLSearchParams(window.location.search);
      const urlMarketId = urlParams.get("m");
      const cachedMarketId = urlMarketId || sessionStorage.getItem("pw:selectedMarket");
      if (cachedMarketId) {
        const all = [...mapped, ...unmapped];
        const found = all.find(m => m.id === cachedMarketId);
        if (found) {
          useMarketStore.getState().selectMarket(found);
          if (found.location) useMarketStore.getState().selectCountry(found.location);
        }
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
    useMarketStore.getState().selectMarket(market);
  }, []);

  const handleCountryClick = useCallback((countryName: string) => {
    useMarketStore.getState().selectCountry(countryName);
  }, []);

  // Derived panel locations
  const bottomPanelSet = useMemo(() => new Set(bottomPanelOrder), [bottomPanelOrder]);
  const rightVisiblePanels = useMemo(
    () => panelOrder.filter((k) => panelVisibility[k as keyof PanelVisibility] && !bottomPanelSet.has(k)),
    [panelOrder, panelVisibility, bottomPanelSet]
  );
  const bottomVisiblePanels = useMemo(
    () => bottomPanelOrder.filter((k) => panelVisibility[k as keyof PanelVisibility]),
    [bottomPanelOrder, panelVisibility]
  );

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
        mkt.selectCountry(market.location);
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

  const STRENGTH_OPTIONS = [
    { key: "strong", label: "Strong", color: "#ff4444" },
    { key: "moderate", label: "Moderate", color: "#f59e0b" },
    { key: "weak", label: "Weak" },
  ];
  const CATEGORY_OPTIONS = [
    { key: "Politics", label: "Politics" },
    { key: "Crypto", label: "Crypto" },
    { key: "Sports", label: "Sports" },
    { key: "Finance", label: "Finance" },
    { key: "Tech", label: "Tech" },
    { key: "Culture", label: "Culture" },
    { key: "Other", label: "Other" },
  ];

  function renderPanel(key: string) {
    const maxColSpan = bottomPanelSet.has(key) ? 3 : 2;
    switch (key) {
      case "detail":
        return (
          <Panel
            key="detail"
            panelId="detail"
            title="Market Detail"
            badge={selectedMarket ? (
              <span className="panel-data-badge live" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }} onClick={() => useMarketStore.getState().selectMarket(null)} title="Unselect market">
                selected
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
                  title="View on Polymarket"
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
                  title={isWatched(selectedMarket.id) ? "Remove from watchlist" : "Add to watchlist"}
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
                  title="Create alert"
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
                click a market bubble or card to view details
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
          />
        );
      case "country":
        return (
          <Panel
            key="country"
            panelId="country"
            title="Region"
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
                click a region on the map to view related markets
              </div>
            )}
          </Panel>
        );
      case "news": {
        const newsMarket = newsCleared ? null : selectedMarket;
        return (
          <Panel
            key="news"
            panelId="news"
            title="News"
            className="panel-news"
            colSpan={colSpanFor("news")}
            {...panelHandlers["news"]}
            rowSpan={rowSpanFor("news")}
            maxColSpan={maxColSpan}
            headerRight={
              <span className="flex items-center gap-1 text-[10px] font-mono truncate max-w-[250px]" style={{ color: newsMarket ? "var(--green)" : "var(--text-muted)" }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: newsMarket ? "var(--green)" : "var(--text-ghost)" }} />
                <span className="truncate">{newsMarket ? `${newsMarket.title.slice(0, 40)}${newsMarket.title.length > 40 ? "\u2026" : ""}` : "global feed"}</span>
                {selectedMarket && !newsCleared && (
                  <button onClick={() => setNewsCleared(true)} className="shrink-0 text-[13px] text-[var(--text-ghost)] hover:text-[var(--text)] transition-colors leading-none ml-1" title="Show all news">×</button>
                )}
              </span>
            }
          >
            <NewsPanel selectedMarket={newsMarket} />
          </Panel>
        );
      }
      case "tweets": {
        const tweetsMarket = tweetsCleared ? null : selectedMarket;
        return (
          <Panel
            key="tweets"
            panelId="tweets"
            title="Tweets"
            className="panel-tweets"
            colSpan={colSpanFor("tweets")}
            {...panelHandlers["tweets"]}
            rowSpan={rowSpanFor("tweets")}
            maxColSpan={maxColSpan}
            headerRight={
              <span className="flex items-center gap-1 text-[10px] font-mono truncate max-w-[250px]" style={{ color: tweetsMarket ? "var(--green)" : "var(--text-muted)" }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tweetsMarket ? "var(--green)" : "var(--text-ghost)" }} />
                <span className="truncate">{tweetsMarket ? `${tweetsMarket.title.slice(0, 40)}${tweetsMarket.title.length > 40 ? "\u2026" : ""}` : "all accounts"}</span>
                {selectedMarket && !tweetsCleared && (
                  <button onClick={() => setTweetsCleared(true)} className="shrink-0 text-[13px] text-[var(--text-ghost)] hover:text-[var(--text)] transition-colors leading-none ml-1" title="Show all tweets">×</button>
                )}
              </span>
            }
          >
            <TweetsPanel selectedMarket={tweetsMarket} />
          </Panel>
        );
      }
      case "live":
        return (
          <Panel
            key="live"
            panelId="live"
            title="Live Streams"
            className="panel-live"
            badge={<span className="panel-data-badge live">live</span>}
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
            title="Watchlist"
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
                  {watchedCount} watched
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
            />
          </Panel>
        );
      case "leaderboard":
        return (
          <Panel
            key="leaderboard"
            panelId="leaderboard"
            title="Leaderboard"
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
            title="Smart Trades"
            badge={
              smartMoneySmartTrades.length > 0 ? (
                <span className="panel-data-badge live">
                  {smartMoneySmartTrades.length} smart
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
            title="Whale Trades"
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
            title="Order Book"
            badge={selectedMarket && !selectedMarket.closed ? <span className="panel-data-badge live">live</span> : undefined}
            colSpan={colSpanFor("orderbook")}
            {...panelHandlers["orderbook"]}
            rowSpan={rowSpanFor("orderbook")}
            maxColSpan={maxColSpan}
            headerRight={
              selectedMarket ? (
                <span className="text-[10px] font-mono truncate max-w-[200px] text-[var(--text-dim)]" title={selectedMarket.title}>
                  {selectedMarket.title}
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
            title="Trader"
            colSpan={colSpanFor("trader")}
            {...panelHandlers["trader"]}
            rowSpan={rowSpanFor("trader")}
            maxColSpan={maxColSpan}
            headerRight={
              <div className="flex items-center gap-1">
                {traderPanelWallet ? (
                  <>
                    <span className="text-[10px] font-mono text-[var(--text-dim)]" title={traderPanelWallet}>
                      {traderWalletName || `${traderPanelWallet.slice(0, 6)}\u2026${traderPanelWallet.slice(-4)}`}
                    </span>
                    <button
                      onClick={() => { const sm = useSmartMoneyStore.getState(); sm.setTraderPanelWallet(null); sm.setTraderWalletName(null); }}
                      className="text-[10px] text-[var(--text-ghost)] hover:text-[var(--text)] transition-colors"
                      title="Clear"
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
                  GO
                </button>
              </div>
            }
          >
            <TraderPanel
              selectedWallet={traderPanelWallet}
            />
          </Panel>
        );
      }
      case "sentiment":
        return (
          <Panel
            key="sentiment"
            panelId="sentiment"
            title="Sentiment"
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
            title="Price Chart"
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
            title="Arbitrage"
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
            title="Calendar"
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
            title="Signals"
            colSpan={colSpanFor("signals")}
            {...panelHandlers["signals"]}
            rowSpan={rowSpanFor("signals")}
            maxColSpan={maxColSpan}
            headerRight={
              <FilterDropdown groups={[
                { label: "Strength", options: STRENGTH_OPTIONS, selected: sigStrFilter, onChange: setSigStrFilter },
                { label: "Category", options: CATEGORY_OPTIONS, selected: sigCatFilter, onChange: setSigCatFilter },
              ]} />
            }
          >
            <SignalPanel
              trades={smartMoneyTrades}
              markets={[...mapped, ...unmapped]}
              leaderboard={smartMoneyLeaderboard}
              onSelectWallet={handleSmartMoneySelectWallet}
              onSelectMarket={handleSmartMoneySelectMarket}
              categoryFilter={sigCatFilter}
              strengthFilter={sigStrFilter}
            />
          </Panel>
        );
      case "resolution":
        return (
          <Panel
            key="resolution"
            panelId="resolution"
            title="Resolution"
            colSpan={colSpanFor("resolution")}
            {...panelHandlers["resolution"]}
            rowSpan={rowSpanFor("resolution")}
            maxColSpan={maxColSpan}
            headerRight={
              <FilterDropdown groups={[
                { label: "Strength", options: STRENGTH_OPTIONS, selected: resStrFilter, onChange: setResStrFilter },
                { label: "Category", options: CATEGORY_OPTIONS, selected: resCatFilter, onChange: setResCatFilter },
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
            title="Portfolio"
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
      default:
        return null;
    }
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

      <div className="main-content" ref={mainRef} style={{ gridTemplateColumns: isFullscreen ? "1fr" : `${mapWidthPct}% 6px 1fr` } as React.CSSProperties}>
        {/* Map section */}
        <div className="map-section" ref={mapSectionRef}>
          <div className="map-panel-header">
            <span className="panel-title">World Map</span>
            <span className="panel-count">{timeFiltered.length} markets</span>
            <div className="flex-1" />
            <button
              onClick={() => useUIStore.getState().setIsFullscreen(!isFullscreen)}
              className="panel-expand-btn"
              title={isFullscreen ? "Exit map fullscreen" : "Map fullscreen"}
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
            />
          </div>
          {/* Horizontal resize handle + bottom panels (hidden in map fullscreen) */}
          {!isFullscreen && (
            <>
              <div className="flex items-center">
                <ResizeHandle direction="horizontal" onResize={handleHorizontalResize} />
                <button
                  onClick={() => useUIStore.getState().toggleBottomPanel()}
                  className="shrink-0 px-1.5 py-0 text-[9px] text-[var(--text-ghost)] hover:text-[var(--text-muted)] transition-colors z-20"
                  title={bottomPanelCollapsed ? "Expand bottom panel" : "Collapse bottom panel"}
                  style={{ marginLeft: -4 }}
                >
                  {bottomPanelCollapsed ? "\u25B2" : "\u25BC"}
                </button>
              </div>
              {!bottomPanelCollapsed && (bottomVisiblePanels.length > 0 || isDragging) && (
                <div
                  className={`bottom-panels-grid${bottomVisiblePanels.length === 0 ? " bottom-panels-grid-empty" : ""}`}
                  ref={bottomPanelsRef}
                  style={{ height: bottomPanelHeight }}
                >
                  {bottomVisiblePanels.map((key) => <PanelErrorBoundary key={`eb-${key}`} panelName={key}>{renderPanel(key)}</PanelErrorBoundary>)}
                </div>
              )}
            </>
          )}
        </div>

        {/* Vertical resize handle + right panels (hidden in map fullscreen) */}
        {!isFullscreen && !isMobile && (
          <>
            <ResizeHandle direction="vertical" onResize={handleVerticalResize} />
            <div className="panels-grid" ref={panelsRef}>
              {rightVisiblePanels.map((key) => <PanelErrorBoundary key={`eb-${key}`} panelName={key}>{renderPanel(key)}</PanelErrorBoundary>)}
            </div>
          </>
        )}

        {/* Mobile: single panel fullscreen view */}
        {!isFullscreen && isMobile && activeMobilePanel && (
          <div className="mobile-panel-view" ref={panelsRef}>
            <PanelErrorBoundary panelName={activeMobilePanel}>
              {renderPanel(activeMobilePanel)}
            </PanelErrorBoundary>
          </div>
        )}
      </div>

      {/* Mobile bottom tab bar */}
      {isMobile && (
        <MobileTabBar
          activePanel={activeMobilePanel}
          onSelect={(panel) => useUIStore.getState().setActiveMobilePanel(
            panel === "map" ? null : panel
          )}
        />
      )}

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


      <ToastContainer signals={signals} newMarkets={newMarkets} onSelectMarket={handleSelectMarketFromPanel} />
    </div>
  );
}

const MOBILE_TABS: Array<{ id: string; label: string; icon: string }> = [
  { id: "map", label: "Map", icon: "\uD83C\uDF0D" },
  { id: "markets", label: "Markets", icon: "\uD83D\uDCC8" },
  { id: "news", label: "News", icon: "\uD83D\uDCF0" },
  { id: "smartMoney", label: "Smart $", icon: "\uD83D\uDCB0" },
  { id: "more", label: "More", icon: "\u2026" },
];

const MORE_PANELS = ["detail", "country", "tweets", "live", "watchlist", "leaderboard", "whaleTrades", "orderbook", "trader", "sentiment", "chart"];

function MobileTabBar({ activePanel, onSelect }: { activePanel: string | null; onSelect: (id: string) => void }) {
  const [showMore, setShowMore] = useState(false);

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
              {id}
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
                  onSelect("map"); // null will close panel view
                  setShowMore(false);
                } else {
                  onSelect(tab.id);
                  setShowMore(false);
                }
              }}
              className={`mobile-tab${isActive ? " active" : ""}`}
            >
              <span className="mobile-tab-icon">{tab.icon}</span>
              <span className="mobile-tab-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
