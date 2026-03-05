"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import type { TimeRange } from "@/components/TimeRangeFilter";
import { usePanelDrag } from "@/hooks/usePanelDrag";
import ResizeHandle from "@/components/ResizeHandle";
import { usePreferences } from "@/hooks/usePreferences";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useAlerts, AlertConfig } from "@/hooks/useAlerts";
import { useBrowserNotifications } from "@/hooks/useBrowserNotifications";
import WatchlistPanel from "@/components/WatchlistPanel";
import { usePanelColSpans } from "@/hooks/usePanelColSpans";

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
  markets: 2, country: 2, news: 2, live: 2, watchlist: 2, detail: 1,
};

const TIME_THRESHOLDS: Record<TimeRange, number> = {
  "1h": 50000,
  "6h": 20000,
  "24h": 1000,
  "48h": 500,
  "7d": 0,
  ALL: 0,
};

function MapBottomDetail({
  selectedMarket,
  relatedMarkets,
  onBack,
  onSelectMarket,
  onTagClick,
  height,
  isWatched,
  onToggleWatch,
  onCreateAlert,
}: {
  selectedMarket: ProcessedMarket | null;
  relatedMarkets: ProcessedMarket[];
  onBack: () => void;
  onSelectMarket: (m: ProcessedMarket) => void;
  onTagClick: (tag: string) => void;
  height: number;
  isWatched?: boolean;
  onToggleWatch?: () => void;
  onCreateAlert?: () => void;
}) {
  return (
    <div className="map-bottom-panel" style={{ height }}>
      <div className="overlay-header">
        <div className="flex items-center gap-2">
          <span className="panel-title" style={{ fontSize: 11 }}>Market Detail</span>
          {selectedMarket && (
            <span className="panel-data-badge live">selected</span>
          )}
        </div>
        {/* Action buttons in header */}
        {selectedMarket && (
          <div className="flex items-center gap-1">
            {onToggleWatch && (
              <button
                onClick={onToggleWatch}
                className={`flex items-center gap-1 px-1.5 py-0.5 border rounded-sm text-[10px] transition-colors ${
                  isWatched
                    ? "border-[#f59e0b]/40 text-[#f59e0b] hover:bg-[#f59e0b]/10"
                    : "border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)]"
                }`}
                title={isWatched ? "Remove from watchlist" : "Add to watchlist"}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill={isWatched ? "#f59e0b" : "none"} stroke={isWatched ? "#f59e0b" : "currentColor"} strokeWidth="1.5">
                  <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                </svg>
                <span>{isWatched ? "WATCHING" : "WATCH"}</span>
              </button>
            )}
            {onCreateAlert && (
              <button
                onClick={onCreateAlert}
                className="flex items-center gap-1 px-1.5 py-0.5 border border-[var(--border)] rounded-sm text-[10px] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)] transition-colors"
                title="Create alert"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <span>ALERT</span>
              </button>
            )}
            <button
              onClick={onBack}
              className="flex items-center gap-1 px-1.5 py-0.5 border border-[var(--border)] rounded-sm text-[10px] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)] transition-colors"
              title="Close detail"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              <span>CLOSE</span>
            </button>
          </div>
        )}
      </div>
      <div className="overlay-content">
        {selectedMarket ? (
          <MarketDetailPanel
            market={selectedMarket}
            relatedMarkets={relatedMarkets}
            onBack={onBack}
            onSelectMarket={onSelectMarket}
            onTagClick={onTagClick}
          />
        ) : (
          <div className="text-[12px] text-[var(--text-muted)] font-mono">
            click a market bubble or card to view details
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const { prefs, updatePref } = usePreferences();

  const [mapped, setMapped] = useState<ProcessedMarket[]>([]);
  const [unmapped, setUnmapped] = useState<ProcessedMarket[]>([]);
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    () => new Set(prefs.activeCategories as Category[])
  );
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<"live" | "proxy" | "sample">(
    "live"
  );
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<{
    coords: [number, number];
    marketId: string;
  } | null>(null);
  const [signals, setSignals] = useState<ProcessedMarket[]>([]);
  const [newMarkets, setNewMarkets] = useState<ProcessedMarket[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange>(prefs.timeRange as TimeRange);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(prefs.autoRefresh);
  const [selectedMarket, setSelectedMarket] = useState<ProcessedMarket | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelVisibility, setPanelVisibility] = useState<PanelVisibility>(() => {
    const defaults: PanelVisibility = { markets: true, detail: true, country: true, news: true, live: true, watchlist: true };
    return { ...defaults, ...prefs.panelVisibility };
  });
  const [panelOrder, setPanelOrder] = useState<string[]>(() => {
    const po = prefs.panelOrder;
    if (!po.includes("watchlist")) return ["watchlist", ...po];
    return po;
  });
  const panelsRef = useRef<HTMLDivElement>(null);

  // Watchlist
  const { watchedIds, isWatched, toggleWatch, removeWatch, count: watchedCount, addedAt } = useWatchlist();
  const { getColSpan, setColSpan, resetColSpan } = usePanelColSpans();
  const colSpanFor = (id: string) => getColSpan(id, DEFAULT_COL_SPANS[id] ?? 1);

  // Alerts
  const { alerts, history: alertHistory, unreadCount, addAlert, removeAlert, toggleAlert, evaluateAlerts, markRead, markAllRead, clearHistory } = useAlerts();
  const { sendNotification, requestPermission, permission: notifPermission } = useBrowserNotifications();
  const [alertManagerOpen, setAlertManagerOpen] = useState(false);
  const [alertPrefill, setAlertPrefill] = useState<{ marketId?: string; marketTitle?: string } | undefined>(undefined);

  // Sync preferences back to localStorage
  useEffect(() => { updatePref("activeCategories", Array.from(activeCategories)); }, [activeCategories, updatePref]);
  useEffect(() => { updatePref("timeRange", timeRange); }, [timeRange, updatePref]);
  useEffect(() => { updatePref("autoRefresh", autoRefresh); }, [autoRefresh, updatePref]);
  useEffect(() => { updatePref("panelVisibility", panelVisibility); }, [panelVisibility, updatePref]);
  useEffect(() => { updatePref("panelOrder", panelOrder); }, [panelOrder, updatePref]);

  const handlePanelReorder = useCallback((newOrder: string[]) => {
    setPanelOrder(newOrder);
  }, []);

  usePanelDrag(panelsRef, panelOrder, handlePanelReorder);

  // Resize state: left/right split (percentage of viewport) and top/bottom split (px)
  const [mapWidthPct, setMapWidthPct] = useState(prefs.mapWidthPct);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(420);
  const [marketSearch, setMarketSearch] = useState<string | undefined>(undefined);
  const [region, setRegion] = useState<string>(prefs.region);
  const [colorMode, setColorMode] = useState<"category" | "impact">(prefs.colorMode);

  // Sync remaining preferences
  useEffect(() => { updatePref("mapWidthPct", mapWidthPct); }, [mapWidthPct, updatePref]);
  useEffect(() => { updatePref("colorMode", colorMode); }, [colorMode, updatePref]);
  useEffect(() => { updatePref("region", region); }, [region, updatePref]);
  const mainRef = useRef<HTMLDivElement>(null);
  const mapSectionRef = useRef<HTMLDivElement>(null);

  const handleHorizontalResize = useCallback((delta: number) => {
    const sectionH = mapSectionRef.current?.getBoundingClientRect().height;
    if (!sectionH) return;
    setBottomPanelHeight((prev) => Math.max(120, Math.min(sectionH - 120, prev - delta)));
  }, []);

  const handleVerticalResize = useCallback((delta: number) => {
    const totalW = mainRef.current?.getBoundingClientRect().width;
    if (!totalW) return;
    setMapWidthPct((prev) => Math.max(30, Math.min(80, prev + (delta / totalW) * 100)));
  }, []);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const flyToTimer = useRef<NodeJS.Timeout | null>(null);
  const seenSignalIds = useRef<Set<string>>(new Set());
  const seenMarketIds = useRef<Set<string>>(new Set());
  const isFirstLoad = useRef(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
        if (found) setSelectedMarket(found);
      }
      const cachedCountry = sessionStorage.getItem("pw:selectedCountry");
      if (cachedCountry) setSelectedCountry(cachedCountry);
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

  // Alert evaluation on data refresh
  const alertEvalRef = useRef(false);
  useEffect(() => {
    if (mapped.length === 0 && unmapped.length === 0) return;
    if (!alertEvalRef.current) {
      // Skip first load — need two data points to detect crossings
      alertEvalRef.current = true;
      // Initialize prevProbs
      evaluateAlerts([...mapped, ...unmapped], new Set());
      return;
    }
    const newIds = new Set<string>();
    for (const m of [...mapped, ...unmapped]) {
      if (!seenMarketIds.current.has(m.id)) {
        // Note: seenMarketIds is already updated in fetchData, but newMarkets state has the fresh ones
      }
    }
    // Use newMarkets state for new market detection
    const freshIds = new Set(newMarkets.map((m) => m.id));
    const triggered = evaluateAlerts([...mapped, ...unmapped], freshIds);
    for (const t of triggered) {
      sendNotification("PolyWorld Alert", { body: t.message });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapped, unmapped]);

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const handleToggleCategory = useCallback((cat: Category) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const handleFlyTo = useCallback(
    (coords: [number, number], marketId: string) => {
      if (flyToTimer.current) clearTimeout(flyToTimer.current);
      setFlyToTarget({ coords, marketId });
      flyToTimer.current = setTimeout(() => setFlyToTarget(null), 3000);
    },
    []
  );

  const handleMarketClick = useCallback((market: ProcessedMarket) => {
    setSelectedMarket(market);
    try { sessionStorage.setItem("pw:selectedMarket", market.id); } catch {}
  }, []);

  const handleCountryClick = useCallback((countryName: string) => {
    setSelectedCountry(countryName);
    try { sessionStorage.setItem("pw:selectedCountry", countryName); } catch {}
  }, []);

  const handleToggleAutoRefresh = useCallback(() => {
    setAutoRefresh((prev) => !prev);
  }, []);

  const handleTogglePanelVisibility = useCallback((panel: string) => {
    setPanelVisibility((prev) => ({ ...prev, [panel]: !prev[panel as keyof PanelVisibility] }));
  }, []);

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

  const timeFiltered = useMemo(() => {
    const threshold = TIME_THRESHOLDS[timeRange];
    if (threshold === 0) return mapped;
    return mapped.filter((m) => (m.volume24h || 0) >= threshold);
  }, [mapped, timeRange]);

  const handleSelectMarketFromPanel = useCallback(
    (market: ProcessedMarket) => {
      setSelectedMarket(market);
      try { sessionStorage.setItem("pw:selectedMarket", market.id); } catch {}
      if (market.coords) handleFlyTo(market.coords, market.id);
    },
    [handleFlyTo]
  );

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
        onOpenSettings={() => setSettingsOpen(true)}
        watchedCount={watchedCount}
        alertUnreadCount={unreadCount}
        alertManagerOpen={alertManagerOpen}
        onOpenAlertManager={() => setAlertManagerOpen((v) => !v)}
        onCloseAlertManager={() => { setAlertManagerOpen(false); setAlertPrefill(undefined); }}
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
              onToggleCategory={handleToggleCategory}
              onToggleFullscreen={handleToggleFullscreen}
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
            />
          </div>
          {/* Horizontal resize handle between map and bottom panel */}
          <ResizeHandle direction="horizontal" onResize={handleHorizontalResize} />
          {/* Detail panel at bottom of map */}
          <MapBottomDetail
            selectedMarket={selectedMarket}
            relatedMarkets={relatedMarkets}
            onBack={() => { setSelectedMarket(null); try { sessionStorage.removeItem("pw:selectedMarket"); } catch {} }}
            onSelectMarket={handleSelectMarketFromPanel}
            onTagClick={(tag) => setMarketSearch(tag)}
            height={bottomPanelHeight}
            isWatched={selectedMarket ? isWatched(selectedMarket.id) : undefined}
            onToggleWatch={selectedMarket ? () => toggleWatch(selectedMarket.id) : undefined}
            onCreateAlert={selectedMarket ? () => {
              setAlertPrefill({ marketId: selectedMarket.id, marketTitle: selectedMarket.title });
              setAlertManagerOpen(true);
            } : undefined}
          />
        </div>

        {/* Vertical resize handle between map and panels */}
        <ResizeHandle direction="vertical" onResize={handleVerticalResize} />

        {/* Panels grid — rendered in drag-reorderable order */}
        {!isFullscreen && (
          <div className="panels-grid" ref={panelsRef}>
            {panelOrder.filter((key) => panelVisibility[key as keyof PanelVisibility]).map((key) => {
              switch (key) {
                case "markets":
                  return (
                    <MarketsPanel
                      key="markets"
                      mapped={mapped}
                      unmapped={unmapped}
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
                    />
                  );
                case "country":
                  return (
                    <Panel
                      key="country"
                      panelId="country"
                      title="Country"
                      count={selectedCountry || "—"}
                      colSpan={colSpanFor("country")}
                      onColSpanChange={(s) => setColSpan("country", s)}
                      onColSpanReset={() => resetColSpan("country")}
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
                          click a country on the map to view related markets
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
                        onRemoveWatch={removeWatch}
                        isWatched={isWatched}
                        onToggleWatch={toggleWatch}
                      />
                    </Panel>
                  );
                default:
                  return null;
              }
            })}
          </div>
        )}
      </div>

      {settingsOpen && (
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          activeCategories={activeCategories}
          onToggleCategory={handleToggleCategory}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={handleToggleAutoRefresh}
          panelVisibility={panelVisibility}
          onTogglePanelVisibility={handleTogglePanelVisibility}
          dataMode={dataMode}
          lastSyncTime={lastSyncTime}
          marketCount={mapped.length}
          globalCount={unmapped.length}
        />
      )}


      <ToastContainer signals={signals} newMarkets={newMarkets} mapWidthPct={mapWidthPct} onSelectMarket={handleSelectMarketFromPanel} />
    </div>
  );
}
