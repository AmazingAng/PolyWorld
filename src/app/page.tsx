"use client";

import { useEffect, useCallback, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { ProcessedMarket, Category } from "@/types";
import { processEvents, getSampleData } from "@/lib/polymarket";
import Header from "@/components/Header";
import Panel from "@/components/Panel";
import MarketsPanel from "@/components/MarketsPanel";
import MarketDetailPanel from "@/components/MarketDetailPanel";
import CountryPanel from "@/components/CountryPanel";
import LivePanel from "@/components/LivePanel";
import NewsPanel from "@/components/NewsPanel";
import SettingsModal from "@/components/SettingsModal";
import type { PanelVisibility } from "@/components/SettingsModal";
import ToastContainer from "@/components/Toast";
import { usePanelDrag } from "@/hooks/usePanelDrag";
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
  markets: 2, country: 2, news: 2, tweets: 1, live: 2, watchlist: 2, detail: 2, leaderboard: 1, trader: 2, smartMoney: 1, whaleTrades: 1, orderbook: 1, sentiment: 1, chart: 2,
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

  const panelsRef = useRef<HTMLDivElement>(null);
  const bottomPanelsRef = useRef<HTMLDivElement>(null);

  // Watchlist
  const { watchedIds, isWatched, toggleWatch, count: watchedCount, addedAt } = useWatchlist();
  const { getColSpan, setColSpan, resetColSpan } = usePanelColSpans();
  const colSpanFor = (id: string) => getColSpan(id, DEFAULT_COL_SPANS[id] ?? 1);
  const { getRowSpan, setRowSpan, resetRowSpan } = usePanelRowSpans();
  const rowSpanFor = (id: string) => getRowSpan(id, 2);

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

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const smartMoneyTimerRef = useRef<NodeJS.Timeout | null>(null);
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

  // Restore cached selections after data loads
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || (mapped.length === 0 && unmapped.length === 0)) return;
    restoredRef.current = true;
    try {
      const cachedMarketId = sessionStorage.getItem("pw:selectedMarket");
      if (cachedMarketId) {
        const all = [...mapped, ...unmapped];
        const found = all.find(m => m.id === cachedMarketId);
        if (found) useMarketStore.getState().selectMarket(found);
      }
      const cachedCountry = sessionStorage.getItem("pw:selectedCountry");
      if (cachedCountry) useMarketStore.getState().selectCountry(cachedCountry);
    } catch {}
  }, [mapped, unmapped]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh) {
      timerRef.current = setInterval(fetchData, REFRESH_INTERVAL);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData, autoRefresh]);

  // Independent 30s polling for smart money
  useEffect(() => {
    if (smartMoneyTimerRef.current) clearInterval(smartMoneyTimerRef.current);
    if (autoRefresh) {
      smartMoneyTimerRef.current = setInterval(fetchSmartMoney, 30_000);
    }
    return () => {
      if (smartMoneyTimerRef.current) clearInterval(smartMoneyTimerRef.current);
    };
  }, [fetchSmartMoney, autoRefresh]);

  // Alert evaluation on data refresh
  const alertEvalRef = useRef(false);
  useEffect(() => {
    if (mapped.length === 0 && unmapped.length === 0) return;
    if (!alertEvalRef.current) {
      alertEvalRef.current = true;
      evaluateAlerts([...mapped, ...unmapped], new Set());
      return;
    }
    const freshIds = new Set(newMarkets.map((m) => m.id));
    const triggered = evaluateAlerts([...mapped, ...unmapped], freshIds);
    for (const t of triggered) {
      sendNotification("PolyWorld Alert", { body: t.message });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapped, unmapped]);

  useEffect(() => {
    const handler = () => useUIStore.getState().setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

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

  // Related markets for detail panel
  const relatedMarkets = useMemo(() => {
    if (!selectedMarket) return [];
    const all = [...mapped, ...unmapped];
    return all
      .filter(
        (m) =>
          m.id !== selectedMarket.id &&
          (m.category === selectedMarket.category ||
            (selectedMarket.location && m.location === selectedMarket.location))
      )
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
      .slice(0, 5);
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
            onColSpanChange={(s) => setColSpan("detail", s)}
            onColSpanReset={() => resetColSpan("detail")}
            rowSpan={rowSpanFor("detail")}
            onRowSpanChange={(s) => setRowSpan("detail", s)}
            onRowSpanReset={() => resetRowSpan("detail")}
            maxColSpan={maxColSpan}
            headerRight={selectedMarket ? (
              <div className="flex items-center gap-1">
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
            onColSpanChange={(s) => setColSpan("markets", s)}
            onColSpanReset={() => resetColSpan("markets")}
            rowSpan={rowSpanFor("markets")}
            onRowSpanChange={(s) => setRowSpan("markets", s)}
            onRowSpanReset={() => resetRowSpan("markets")}
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
            onColSpanChange={(s) => setColSpan("country", s)}
            onColSpanReset={() => resetColSpan("country")}
            rowSpan={rowSpanFor("country")}
            onRowSpanChange={(s) => setRowSpan("country", s)}
            onRowSpanReset={() => resetRowSpan("country")}
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
      case "news":
        return (
          <Panel
            key="news"
            panelId="news"
            title="News"
            className="panel-news"
            colSpan={colSpanFor("news")}
            onColSpanChange={(s) => setColSpan("news", s)}
            onColSpanReset={() => resetColSpan("news")}
            rowSpan={rowSpanFor("news")}
            onRowSpanChange={(s) => setRowSpan("news", s)}
            onRowSpanReset={() => resetRowSpan("news")}
            maxColSpan={maxColSpan}
            headerRight={
              <span className="flex items-center gap-1 text-[10px] font-mono truncate max-w-[250px]" style={{ color: selectedMarket ? "var(--green)" : "var(--text-muted)" }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: selectedMarket ? "var(--green)" : "var(--text-ghost)" }} />
                {selectedMarket
                  ? `${selectedMarket.title.slice(0, 50)}${selectedMarket.title.length > 50 ? "\u2026" : ""}`
                  : "global feed"}
              </span>
            }
          >
            <NewsPanel selectedMarket={selectedMarket} />
          </Panel>
        );
      case "tweets":
        return (
          <Panel
            key="tweets"
            panelId="tweets"
            title="Tweets"
            className="panel-tweets"
            colSpan={colSpanFor("tweets")}
            onColSpanChange={(s) => setColSpan("tweets", s)}
            onColSpanReset={() => resetColSpan("tweets")}
            rowSpan={rowSpanFor("tweets")}
            onRowSpanChange={(s) => setRowSpan("tweets", s)}
            onRowSpanReset={() => resetRowSpan("tweets")}
            maxColSpan={maxColSpan}
            headerRight={
              <span className="flex items-center gap-1 text-[10px] font-mono truncate max-w-[250px]" style={{ color: selectedMarket ? "var(--green)" : "var(--text-muted)" }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: selectedMarket ? "var(--green)" : "var(--text-ghost)" }} />
                {selectedMarket
                  ? `${selectedMarket.title.slice(0, 50)}${selectedMarket.title.length > 50 ? "\u2026" : ""}`
                  : "all accounts"}
              </span>
            }
          >
            <TweetsPanel selectedMarket={selectedMarket} />
          </Panel>
        );
      case "live":
        return (
          <Panel
            key="live"
            panelId="live"
            title="Live Streams"
            className="panel-live"
            badge={<span className="panel-data-badge live">live</span>}
            colSpan={colSpanFor("live")}
            onColSpanChange={(s) => setColSpan("live", s)}
            onColSpanReset={() => resetColSpan("live")}
            rowSpan={rowSpanFor("live")}
            onRowSpanChange={(s) => setRowSpan("live", s)}
            onRowSpanReset={() => resetRowSpan("live")}
            maxColSpan={maxColSpan}
          >
            <LivePanel />
          </Panel>
        );
      case "watchlist":
        return (
          <Panel
            key="watchlist"
            panelId="watchlist"
            title="Watchlist"
            colSpan={colSpanFor("watchlist")}
            onColSpanChange={(s) => setColSpan("watchlist", s)}
            onColSpanReset={() => resetColSpan("watchlist")}
            rowSpan={rowSpanFor("watchlist")}
            onRowSpanChange={(s) => setRowSpan("watchlist", s)}
            onRowSpanReset={() => resetRowSpan("watchlist")}
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
            onColSpanChange={(s) => setColSpan("leaderboard", s)}
            onColSpanReset={() => resetColSpan("leaderboard")}
            rowSpan={rowSpanFor("leaderboard")}
            onRowSpanChange={(s) => setRowSpan("leaderboard", s)}
            onRowSpanReset={() => resetRowSpan("leaderboard")}
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
              onSelectWallet={(addr) => {
                const sm = useSmartMoneyStore.getState();
                sm.setWalletFilter(addr);
                sm.setTraderPanelWallet(addr);
                const w = smartMoneyLeaderboard.find((e) => e.address === addr);
                sm.setTraderWalletName(w?.username || null);
              }}
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
            onColSpanChange={(s) => setColSpan("smartMoney", s)}
            onColSpanReset={() => resetColSpan("smartMoney")}
            rowSpan={rowSpanFor("smartMoney")}
            onRowSpanChange={(s) => setRowSpan("smartMoney", s)}
            onRowSpanReset={() => resetRowSpan("smartMoney")}
            maxColSpan={maxColSpan}
          >
            <SmartMoneyPanel
              smartTrades={smartMoneySmartTrades}
              walletFilter={smartWalletFilter}
              onClearFilter={() => useSmartMoneyStore.getState().setWalletFilter(null)}
              onSelectWallet={(addr) => {
                const sm = useSmartMoneyStore.getState();
                sm.setTraderPanelWallet(addr);
                const t = smartMoneySmartTrades.find((e) => e.wallet === addr);
                sm.setTraderWalletName(t?.username || null);
              }}
              onSelectMarket={(slug) => {
                const all = [...mapped, ...unmapped];
                const found = all.find(m => m.slug === slug);
                if (found) handleSelectMarketFromPanel(found);
              }}
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
            onColSpanChange={(s) => setColSpan("whaleTrades", s)}
            onColSpanReset={() => resetColSpan("whaleTrades")}
            rowSpan={rowSpanFor("whaleTrades")}
            onRowSpanChange={(s) => setRowSpan("whaleTrades", s)}
            onRowSpanReset={() => resetRowSpan("whaleTrades")}
            maxColSpan={maxColSpan}
          >
            <WhaleTradesPanel
              trades={smartMoneyTrades}
              onSelectWallet={(addr) => {
                const sm = useSmartMoneyStore.getState();
                sm.setTraderPanelWallet(addr);
                const t = smartMoneyTrades.find((e) => e.wallet === addr);
                sm.setTraderWalletName(t?.username || null);
              }}
              onSelectMarket={(slug) => {
                const all = [...mapped, ...unmapped];
                const found = all.find(m => m.slug === slug);
                if (found) handleSelectMarketFromPanel(found);
              }}
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
            onColSpanChange={(s) => setColSpan("orderbook", s)}
            onColSpanReset={() => resetColSpan("orderbook")}
            rowSpan={rowSpanFor("orderbook")}
            onRowSpanChange={(s) => setRowSpan("orderbook", s)}
            onRowSpanReset={() => resetRowSpan("orderbook")}
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
            onColSpanChange={(s) => setColSpan("trader", s)}
            onColSpanReset={() => resetColSpan("trader")}
            rowSpan={rowSpanFor("trader")}
            onRowSpanChange={(s) => setRowSpan("trader", s)}
            onRowSpanReset={() => resetRowSpan("trader")}
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
            onColSpanChange={(s) => setColSpan("sentiment", s)}
            onColSpanReset={() => resetColSpan("sentiment")}
            rowSpan={rowSpanFor("sentiment")}
            onRowSpanChange={(s) => setRowSpan("sentiment", s)}
            onRowSpanReset={() => resetRowSpan("sentiment")}
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
            onColSpanChange={(s) => setColSpan("chart", s)}
            onColSpanReset={() => resetColSpan("chart")}
            rowSpan={rowSpanFor("chart")}
            onRowSpanChange={(s) => setRowSpan("chart", s)}
            onRowSpanReset={() => resetRowSpan("chart")}
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
        whaleTradeCount={smartMoneyTrades.length}
        alertUnreadCount={unreadCount}
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

      <div className="main-content" ref={mainRef} style={{ gridTemplateColumns: `${mapWidthPct}% 6px 1fr` } as React.CSSProperties}>
        {/* Map section */}
        <div className="map-section" ref={mapSectionRef}>
          <div className="map-panel-header">
            <span className="panel-title">World Map</span>
            <span className="panel-count">{timeFiltered.length} markets</span>
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
          {/* Horizontal resize handle between map and bottom panels */}
          <ResizeHandle direction="horizontal" onResize={handleHorizontalResize} />
          {/* Bottom panels grid */}
          {(bottomVisiblePanels.length > 0 || isDragging) && (
            <div
              className={`bottom-panels-grid${bottomVisiblePanels.length === 0 ? " bottom-panels-grid-empty" : ""}`}
              ref={bottomPanelsRef}
              style={{ height: bottomPanelHeight }}
            >
              {bottomVisiblePanels.map((key) => renderPanel(key))}
            </div>
          )}
        </div>

        {/* Vertical resize handle between map and panels */}
        <ResizeHandle direction="vertical" onResize={handleVerticalResize} />

        {/* Right panels grid */}
        {!isFullscreen && (
          <div className="panels-grid" ref={panelsRef}>
            {rightVisiblePanels.map((key) => renderPanel(key))}
          </div>
        )}
      </div>

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
