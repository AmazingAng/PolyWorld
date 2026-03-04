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
import SettingsModal from "@/components/SettingsModal";
import type { PanelVisibility } from "@/components/SettingsModal";
import ToastContainer from "@/components/Toast";
import type { TimeRange } from "@/components/TimeRangeFilter";
import { usePanelDrag } from "@/hooks/usePanelDrag";
import ResizeHandle from "@/components/ResizeHandle";

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
  height,
}: {
  selectedMarket: ProcessedMarket | null;
  relatedMarkets: ProcessedMarket[];
  onBack: () => void;
  onSelectMarket: (m: ProcessedMarket) => void;
  height: number;
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
      </div>
      <div className="overlay-content">
        {selectedMarket ? (
          <MarketDetailPanel
            market={selectedMarket}
            relatedMarkets={relatedMarkets}
            onBack={onBack}
            onSelectMarket={onSelectMarket}
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
  const [mapped, setMapped] = useState<ProcessedMarket[]>([]);
  const [unmapped, setUnmapped] = useState<ProcessedMarket[]>([]);
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    () =>
      new Set([
        "Politics",
        "Geopolitics",
        "Crypto",
        "Sports",
        "Finance",
        "Tech",
        "Culture",
        "Other",
      ])
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
  const [timeRange, setTimeRange] = useState<TimeRange>("ALL");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedMarket, setSelectedMarket] = useState<ProcessedMarket | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelVisibility, setPanelVisibility] = useState<PanelVisibility>({
    markets: true,
    detail: true,
    country: true,
    live: true,
  });
  const [panelOrder, setPanelOrder] = useState<string[]>(["markets", "country", "live"]);
  const panelsRef = useRef<HTMLDivElement>(null);

  const handlePanelReorder = useCallback((newOrder: string[]) => {
    setPanelOrder(newOrder);
  }, []);

  usePanelDrag(panelsRef, handlePanelReorder);

  // Resize state: left/right split (percentage of viewport) and top/bottom split (px)
  const [mapWidthPct, setMapWidthPct] = useState(58);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(280);
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

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh) {
      timerRef.current = setInterval(fetchData, REFRESH_INTERVAL);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData, autoRefresh]);

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
  }, []);

  const handleCountryClick = useCallback((countryName: string) => {
    setSelectedCountry(countryName);
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
            />
          </div>
          {/* Horizontal resize handle between map and bottom panel */}
          <ResizeHandle direction="horizontal" onResize={handleHorizontalResize} />
          {/* Detail panel at bottom of map */}
          <MapBottomDetail
            selectedMarket={selectedMarket}
            relatedMarkets={relatedMarkets}
            onBack={() => setSelectedMarket(null)}
            onSelectMarket={handleSelectMarketFromPanel}
            height={bottomPanelHeight}
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
                    />
                  );
                case "country":
                  return (
                    <Panel
                      key="country"
                      panelId="country"
                      title="Country"
                      count={selectedCountry || "—"}
                    >
                      {selectedCountry ? (
                        <CountryPanel
                          countryName={selectedCountry}
                          mapped={mapped}
                          unmapped={unmapped}
                          onSelectMarket={handleSelectMarketFromPanel}
                        />
                      ) : (
                        <div className="text-[12px] text-[#777] font-mono">
                          click a country on the map to view related markets
                        </div>
                      )}
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
                    >
                      <LivePanel />
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

      <ToastContainer signals={signals} newMarkets={newMarkets} />
    </div>
  );
}
