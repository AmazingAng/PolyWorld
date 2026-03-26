"use client";

import React, { useEffect, useRef, useCallback, useState, lazy, Suspense, memo } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ProcessedMarket, Category, WhaleTrade } from "@/types";
import { CATEGORY_COLORS, CATEGORY_SHAPES, CATEGORY_EMOJI, detectSubEmoji, ALL_SUB_EMOJIS } from "@/lib/categories";
import { IMPACT_COLORS } from "@/lib/impact";
import type { ImpactLevel } from "@/types";
import { formatVolume, formatPct, formatChange } from "@/lib/format";
import { REGIONAL_VIEWS } from "@/lib/regions";
import { topojsonFeature } from "@/lib/topojson";
import { getCountryFlag, marketMatchesCountry } from "@/lib/countries";
import type { TimeRange } from "./TimeRangeFilter";
import MapToolbar from "./MapToolbar";
import { useI18n } from "@/i18n";
import { localizeMarket } from "@/hooks/useLocalizedMarket";
import type { OverlayLayer } from "./MapToolbar";

const MarketPreview = lazy(() => import("./MarketPreview"));

// CARTO GL vector tile style — gives us zoom-dependent labels:
// zoomed out = continent names only, zoomed in = country names + borders
const DARK_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export type ColorMode = "category" | "impact";

interface WorldMapProps {
  markets: ProcessedMarket[];
  activeCategories: Set<Category>;
  flyToTarget: { coords: [number, number]; marketId: string } | null;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  onToggleCategory: (category: Category) => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  onMarketClick?: (market: ProcessedMarket) => void;
  onCountryClick?: (countryName: string) => void;
  selectedCountry?: string | null;
  selectedMarketId?: string | null;
  colorMode?: ColorMode;
  onColorModeChange?: (mode: ColorMode) => void;
  region?: string | null;
  onRegionChange?: (region: string) => void;
  isWatched?: (id: string) => boolean;
  onToggleWatch?: (id: string) => void;
  newMarkets?: ProcessedMarket[];
  whaleTrades?: WhaleTrade[];
  activeLayers?: Set<OverlayLayer>;
  onToggleLayer?: (layer: OverlayLayer) => void;
  onTrade?: (state: import("./TradeModal").TradeModalState) => void;
  onMapTap?: () => void;
}

// ─── 3-Tier Geographic Hierarchy ─────────────────────────────────
// Tier 0 (zoom < 2.5): Continental — one bubble per continent/macro-region
// Tier 1 (zoom 2.5–4): Country groups — large countries separate, small countries merge by sub-region
// Tier 2 (zoom 4–6): Country-level — each country is its own bubble
// Tier 3 (zoom > 6): Individual bubbles (offsetColocated only)

const ZOOM_TIER_THRESHOLDS = [0];

const CONTINENT_MAP: Record<string, string> = {
  "United States": "Americas", Canada: "Americas", Mexico: "Americas",
  Brazil: "Americas", Argentina: "Americas", Colombia: "Americas",
  Chile: "Americas", Peru: "Americas", Venezuela: "Americas",
  Ecuador: "Americas", Bolivia: "Americas", Uruguay: "Americas",
  Paraguay: "Americas", Cuba: "Americas", "Costa Rica": "Americas",
  Panama: "Americas", Guatemala: "Americas", Honduras: "Americas",
  "El Salvador": "Americas", Nicaragua: "Americas",
  "Dominican Republic": "Americas", "Puerto Rico": "Americas",
  Jamaica: "Americas", "Trinidad and Tobago": "Americas",
  "United Kingdom": "Europe", France: "Europe", Germany: "Europe",
  Italy: "Europe", Spain: "Europe", Portugal: "Europe",
  Netherlands: "Europe", Belgium: "Europe", Switzerland: "Europe",
  Austria: "Europe", Sweden: "Europe", Norway: "Europe",
  Denmark: "Europe", Finland: "Europe", Poland: "Europe",
  Ireland: "Europe", "Czech Republic": "Europe", Czechia: "Europe",
  Romania: "Europe", Greece: "Europe", Hungary: "Europe",
  Ukraine: "Europe", Croatia: "Europe", Serbia: "Europe",
  Bulgaria: "Europe", Slovakia: "Europe", Slovenia: "Europe",
  Estonia: "Europe", Latvia: "Europe", Lithuania: "Europe",
  Luxembourg: "Europe", Iceland: "Europe", Malta: "Europe",
  Cyprus: "Europe", Albania: "Europe", "North Macedonia": "Europe",
  Montenegro: "Europe", "Bosnia and Herzegovina": "Europe",
  Moldova: "Europe", Belarus: "Europe", Georgia: "Europe",
  Armenia: "Europe", Azerbaijan: "Europe",
  China: "East Asia", Japan: "East Asia", "South Korea": "East Asia",
  "Hong Kong": "East Asia", Mongolia: "East Asia",
  India: "South Asia", Pakistan: "South Asia", Bangladesh: "South Asia",
  "Sri Lanka": "South Asia", Nepal: "South Asia", Afghanistan: "South Asia",
  Thailand: "SE Asia", Vietnam: "SE Asia", Indonesia: "SE Asia",
  Philippines: "SE Asia", Singapore: "SE Asia", Malaysia: "SE Asia",
  Myanmar: "SE Asia", Cambodia: "SE Asia", Laos: "SE Asia",
  Israel: "Middle East", UAE: "Middle East",
  "United Arab Emirates": "Middle East", "Saudi Arabia": "Middle East",
  Turkey: "Middle East", Iran: "Middle East", Iraq: "Middle East",
  Qatar: "Middle East", Kuwait: "Middle East", Bahrain: "Middle East",
  Oman: "Middle East", Jordan: "Middle East", Lebanon: "Middle East",
  Nigeria: "Africa", "South Africa": "Africa", Kenya: "Africa",
  Egypt: "Africa", Ethiopia: "Africa", Ghana: "Africa",
  Tanzania: "Africa", Morocco: "Africa", Algeria: "Africa",
  Tunisia: "Africa", Uganda: "Africa", Senegal: "Africa",
  Australia: "Oceania", "New Zealand": "Oceania",
  Russia: "Russia/CIS", Kazakhstan: "Russia/CIS",
};

// Tier 1: large countries stay separate, small countries merge by sub-region
function getContinentByCoords(lat: number, lng: number): string {
  if (lng > -170 && lng < -30 && lat > 15) return "Americas";
  if (lng > -85 && lng < -30 && lat <= 15) return "Americas";
  if (lng > -25 && lng < 45 && lat > 35) return "Europe";
  if (lng > -20 && lng < 55 && lat >= -35 && lat <= 37) return "Africa";
  if (lng >= 25 && lng < 65 && lat > 10 && lat < 45) return "Middle East";
  if (lng >= 65 && lng < 150 && lat > 20) return "East Asia";
  if (lng >= 95 && lng < 155 && lat >= -15 && lat <= 25) return "SE Asia";
  if (lng >= 110 && lat < -10) return "Oceania";
  if (lng >= 65 && lng < 95 && lat > 0 && lat <= 35) return "South Asia";
  return "Other";
}

function getGroupKey(m: ProcessedMarket, tier: number): string {
  if (!m.coords || !m.location) return m.id;
  if (tier === 0) {
    return CONTINENT_MAP[m.location] ?? getContinentByCoords(m.coords[0], m.coords[1]);
  }
  return m.id; // tier 1: individual
}

function snapToGroupCentroids(
  markets: ProcessedMarket[],
  groupKeyFn: (m: ProcessedMarket) => string,
): ProcessedMarket[] {
  const groups = new Map<string, { sumLat: number; sumLng: number; count: number }>();
  for (const m of markets) {
    if (!m.coords) continue;
    const key = groupKeyFn(m);
    const g = groups.get(key);
    if (g) { g.sumLat += m.coords[0]; g.sumLng += m.coords[1]; g.count++; }
    else groups.set(key, { sumLat: m.coords[0], sumLng: m.coords[1], count: 1 });
  }
  return markets.map((m) => {
    if (!m.coords) return m;
    const key = groupKeyFn(m);
    const g = groups.get(key);
    if (!g || g.count <= 1) return m;
    return { ...m, coords: [g.sumLat / g.count, g.sumLng / g.count] as [number, number] };
  });
}

function zoomToTier(zoom: number): number {
  if (zoom < ZOOM_TIER_THRESHOLDS[0]) return 0;
  return 1;
}

// Offset co-located markers using golden-angle spiral for organic non-overlapping layout.
// Uses FIXED geographic offsets — zoom-in naturally separates bubbles via map projection.
// No zoom dependency: avoids the "separate then collapse" problem of recalculating on zoom.
function offsetColocated(markets: ProcessedMarket[]): ProcessedMarket[] {
  // Group nearby markets using a grid with 0.5° cells
  const cellSize = 0.5;
  const groups = new Map<string, ProcessedMarket[]>();
  for (const m of markets) {
    if (!m.coords) continue;
    const key = `${Math.floor(m.coords[0] / cellSize)},${Math.floor(m.coords[1] / cellSize)}`;
    const arr = groups.get(key) || [];
    arr.push(m);
    groups.set(key, arr);
  }

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  const result: ProcessedMarket[] = [];
  for (const m of markets) {
    if (!m.coords) {
      result.push(m);
      continue;
    }
    const key = `${Math.floor(m.coords[0] / cellSize)},${Math.floor(m.coords[1] / cellSize)}`;
    const group = groups.get(key)!;
    if (group.length <= 1) {
      result.push(m);
      continue;
    }
    const idx = group.indexOf(m);
    // Tighter spacing to keep bubbles near their country centroid.
    const spacing = group.length > 50 ? 0.4 : group.length > 15 ? 0.3 : group.length > 5 ? 0.2 : 0.15;
    // Start from idx+1 so first item is NOT at center (avoids pile-up at origin)
    const n = idx + 1;
    const angle = n * goldenAngle;
    const r = spacing * Math.sqrt(n);
    const offsetLat = r * Math.cos(angle);
    const offsetLng = r * Math.sin(angle);
    result.push({
      ...m,
      coords: [m.coords[0] + offsetLat, m.coords[1] + offsetLng] as [number, number],
    });
  }
  return result;
}

function setsEqual<T>(a?: Set<T>, b?: Set<T>): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// All overlay data is fetched via the local Next.js proxy (/api/overlay?layer=X)
// which handles external API calls server-side, bypassing the browser CSP connect-src policy.
async function fetchOverlayData(layer: OverlayLayer): Promise<GeoJSON.FeatureCollection> {
  try {
    const res = await fetch(`/api/overlay?layer=${layer}`);
    if (!res.ok) throw new Error(`overlay proxy ${res.status}`);
    return res.json() as Promise<GeoJSON.FeatureCollection>;
  } catch (err) {
    console.error(`[overlay] fetch failed for "${layer}":`, err);
    return { type: "FeatureCollection", features: [] };
  }
}

function WorldMapInner({
  markets,
  activeCategories,
  flyToTarget,
  timeRange,
  onTimeRangeChange,
  onToggleCategory,
  onToggleFullscreen,
  isFullscreen,
  onMarketClick,
  onCountryClick,
  selectedCountry,
  selectedMarketId,
  colorMode = "category",
  onColorModeChange,
  region,
  onRegionChange,
  isWatched,
  onToggleWatch,
  newMarkets,
  whaleTrades,
  activeLayers,
  onToggleLayer,
  onTrade,
  onMapTap,
}: WorldMapProps) {
  const { locale, t } = useI18n();
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [currentTier, setCurrentTier] = useState(() => zoomToTier(1.2));
  const marketsLookup = useRef<Map<string, ProcessedMarket>>(new Map());
  const countryLayersAdded = useRef(false);
  const pulseRef = useRef<number>(0);

  const newMarketAnimRef = useRef<Map<string, { startTime: number; lng: number; lat: number }>>(new Map());

  const tradeFlashesRef = useRef<{ key: string; lng: number; lat: number; startTime: number; side: "BUY" | "SELL"; isSmart: boolean }[]>([]);
  const seenTradeKeysRef = useRef<Set<string>>(new Set());
  const prevMarketIdsRef = useRef<Map<string, { lng: number; lat: number; color: string }>>(new Map());
  const prevTierRef = useRef<number>(0);
  const closedAnimsRef = useRef<Map<string, { startTime: number; lng: number; lat: number; color: string }>>(new Map());
  const reducedMotionCleanup = useRef<(() => void) | null>(null);
  const overlayFetched = useRef<Set<OverlayLayer>>(new Set());
  const overlayBurstRef = useRef<{ lng: number; lat: number; startTime: number; color: string }[]>([]);
  const [layerAlert, setLayerAlert] = useState<{ emoji: string; label: string; count: number; color: string } | null>(null);
  const layerAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const OVERLAY_META: Partial<Record<OverlayLayer, { emoji: string; label: string; color: string }>> = {
    conflicts:  { emoji: "💥", label: "conflict zones",   color: "#ef4444" },
    intel:      { emoji: "🔍", label: "intel hotspots",   color: "#a855f7" },
    military:   { emoji: "✈️",  label: "military flights", color: "#22d3ee" },
    weather:    { emoji: "🌩️", label: "weather alerts",   color: "#f59e0b" },
    natural:    { emoji: "🌍", label: "natural events",   color: "#f97316" },
    fires:      { emoji: "🔥", label: "fires",            color: "#ff6b35" },
    elections:  { emoji: "🗳️", label: "elections",        color: "#fbbf24" },
    outages:    { emoji: "📡", label: "internet outages", color: "#e879f9" },
    protests:   { emoji: "✊", label: "protests / unrest",color: "#fb7185" },
    soccer:     { emoji: "⚽", label: "soccer",           color: "#10b981" },
    basketball: { emoji: "🏀", label: "basketball",       color: "#f97316" },
    baseball:   { emoji: "⚾", label: "baseball",         color: "#ef4444" },
    hockey:     { emoji: "🏒", label: "ice hockey",       color: "#38bdf8" },
    tennis:     { emoji: "🎾", label: "tennis",           color: "#a3e635" },
    golf:       { emoji: "⛳", label: "golf",             color: "#4ade80" },
    combat:     { emoji: "🥊", label: "boxing / MMA",     color: "#f43f5e" },
  };

  // Hover preview popup state
  const [hoverMarket, setHoverMarket] = useState<ProcessedMarket | null>(null);
  const [hoverPos, setHoverPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverMarketRef = useRef<ProcessedMarket | null>(null);
  hoverMarketRef.current = hoverMarket;
  const selectedMarketIdRef = useRef(selectedMarketId);
  selectedMarketIdRef.current = selectedMarketId;

  // Country hover popup state
  const [hoverCountry, setHoverCountry] = useState<{ name: string; x: number; y: number } | null>(null);
  const countryHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Overlay layer hover tooltip state
  const [hoverOverlay, setHoverOverlay] = useState<{
    layerId: string;
    color: string;
    title: string;
    rows: { label: string; value: string }[];
    x: number;
    y: number;
  } | null>(null);

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  const PREVIEW_W = isMobile ? Math.min(300, window.innerWidth - 16) : 480;
  const PREVIEW_MAX_H = isMobile ? 360 : 520;

  const clearHoverPopup = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHoverMarket(null);
    setHoverPos(null);
  }, []);

  const applySelectedCountryHighlight = useCallback((map: maplibregl.Map) => {
    const TOPO_NAME: Record<string, string> = {
      "United States": "United States of America",
      "Bosnia": "Bosnia and Herz.",
      "Bosnia and Herzegovina": "Bosnia and Herz.",
      "Czech Republic": "Czechia",
    };
    // Countries that should highlight multiple regions together
    const TOPO_GROUP: Record<string, string[]> = {
      "China": ["China", "Taiwan"],
      "Taiwan": ["China", "Taiwan"],
    };
    const topoNames = selectedCountry
      ? (TOPO_GROUP[selectedCountry] || [TOPO_NAME[selectedCountry] || selectedCountry])
      : [];
    const filter = topoNames.length > 0
      ? ["in", ["get", "name"], ["literal", topoNames]] as maplibregl.FilterSpecification
      : ["==", ["get", "name"], ""] as maplibregl.FilterSpecification;
    if (map.getLayer("country-selected")) {
      map.setFilter("country-selected", filter);
    }
    if (map.getLayer("country-selected-border")) {
      map.setFilter("country-selected-border", filter);
    }
  }, [selectedCountry]);

  // Initialize map with CARTO vector tiles
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: DARK_STYLE,
      center: [10, 25],
      zoom: 1.2,
      minZoom: 1.2,
      maxZoom: 10,
      attributionControl: false,
      renderWorldCopies: false,
      maxPitch: 0,
      pitchWithRotate: false,
      dragRotate: false,
    });

    // Two-finger trackpad swipe → pan; pinch (ctrlKey) → zoom
    // Browsers report pinch as wheel events with ctrlKey=true
    map.scrollZoom.disable();
    const canvas = map.getCanvasContainer();
    const wheelHandler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Pinch gesture → zoom
        e.preventDefault();
        const zoom = map.getZoom();
        const delta = -e.deltaY * 0.02;
        const around = map.unproject(new maplibregl.Point(e.offsetX, e.offsetY));
        map.easeTo({ zoom: zoom + delta, around, duration: 0 });
      } else {
        // Two-finger swipe → pan
        e.preventDefault();
        map.panBy([e.deltaX, e.deltaY], { duration: 0 });
      }
    };
    canvas.addEventListener("wheel", wheelHandler, { passive: false });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // Track zoom tier changes for 2-tier clustering
    map.on("zoom", () => {
      const newTier = zoomToTier(map.getZoom());
      setCurrentTier((prev) => (prev !== newTier ? newTier : prev));
    });

    map.on("style.load", () => {
      // Find the first symbol (label) layer so we can insert market layers below it
      const labelLayerId = map.getStyle().layers?.find(
        (l) => l.type === "symbol" && (l as { layout?: { "text-field"?: unknown } }).layout?.["text-field"]
      )?.id;
      generateShapeIcons(map);
      generateMarketEmojiIcons(map);
      try { addOverlayLayers(map, labelLayerId); } catch (e) { console.error("[overlay] addOverlayLayers failed:", e); }
      addMarketLayers(map, labelLayerId);
      addCountryInteraction(map);

      // Enhance country/continent labels so they stay readable over bubbles
      for (const id of ["place_country_1", "place_country_2", "place_continent"]) {
        if (map.getLayer(id)) {
          map.setPaintProperty(id, "text-halo-width", 2);
          map.setPaintProperty(id, "text-halo-color", "rgba(0,0,0,0.85)");
        }
      }

      mapRef.current = map;
      setMapReady(true);

      // Animated signal pulse + selected ring + beacon + anomaly glow + new market rings + trade flashes
      const reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
      let prefersReducedMotion = reducedMotionMq.matches;
      const onMotionChange = (e: MediaQueryListEvent) => { prefersReducedMotion = e.matches; };
      reducedMotionMq.addEventListener('change', onMotionChange);
      reducedMotionCleanup.current = () => reducedMotionMq.removeEventListener('change', onMotionChange);

      let phase = 0;
      const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
      // Only call setPaintProperty when the value has changed enough to matter visually.
      // This prevents MapLibre from scheduling a GPU redraw every single frame.
      const PAINT_THRESHOLD = 0.004;
      const prev: Record<string, number> = {};
      const setPaint = (layerId: string, prop: string, val: number) => {
        const key = `${layerId}:${prop}`;
        if (Math.abs((prev[key] ?? -1) - val) < PAINT_THRESHOLD) return;
        prev[key] = val;
        map.setPaintProperty(layerId, prop, val);
      };

      const animatePulse = () => {
        if (prefersReducedMotion || document.hidden) {
          // Stop RAF loop when hidden — visibilitychange listener restarts it
          return;
        }
        phase = (phase + 0.04) % (2 * Math.PI);
        const sin = Math.sin(phase);
        const zoom = map.getZoom();
        // Skip setPaint for layers not visible at current zoom
        if (zoom >= 2) {
          if (map.getLayer("signal-glow")) {
            setPaint("signal-glow", "circle-opacity", clamp01(0.15 + 0.1 * sin));
          }
          if (map.getLayer("signal-pulse-ring")) {
            setPaint("signal-pulse-ring", "circle-stroke-opacity", clamp01(0.08 + 0.06 * Math.sin(phase * 0.7)));
          }
          if (map.getLayer("selected-ring")) {
            setPaint("selected-ring", "circle-stroke-opacity", clamp01(0.5 + 0.3 * sin));
            setPaint("selected-ring", "circle-opacity", clamp01(0.08 + 0.04 * sin));
          }
          if (map.getLayer("selected-beacon")) {
            setPaint("selected-beacon", "circle-stroke-opacity", clamp01(0.10 + 0.08 * Math.sin(phase * 0.5)));
          }
          if (map.getLayer("anomaly-glow")) {
            setPaint("anomaly-glow", "circle-opacity", clamp01(0.08 + 0.06 * Math.sin(phase * 1.2)));
          }
        }
        if (zoom >= 3 && map.getLayer("market-breathe-glow")) {
          const breathe = 0.10 + 0.06 * Math.sin(phase * 0.5);
          setPaint("market-breathe-glow", "circle-opacity", clamp01(breathe));
        }

        // Feature 2: new market appearance animations
        const now = performance.now();
        const newAnims = newMarketAnimRef.current;
        if (newAnims.size > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nmFeatures: any[] = [];
          const DURATION = 2000;
          for (const [id, anim] of newAnims) {
            const elapsed = now - anim.startTime;
            if (elapsed > DURATION) { newAnims.delete(id); continue; }
            const t = elapsed / DURATION;

            // Phase 1 (0–0.25): pop-in — core expands from 0, ring bursts out
            // Phase 2 (0.25–1.0): ring fades, core settles
            let ringR: number, strokeW: number, coreR: number, opacity: number, glowR: number, glowOp: number, coreOp: number;
            if (t < 0.25) {
              const p = t / 0.25;
              const ease = 1 - Math.pow(1 - p, 3); // ease-out
              ringR = ease * 22;
              strokeW = 1.5 + ease;
              coreR = ease * 6;
              opacity = ease * 0.9;
              glowR = ease * 30;
              glowOp = ease * 0.25;
              coreOp = ease;
            } else {
              const p = (t - 0.25) / 0.75;
              const ease = 1 - Math.pow(1 - p, 2);
              ringR = 22 + ease * 8;
              strokeW = 2.5 * (1 - ease * 0.6);
              coreR = 6 * (1 - ease);
              opacity = 0.9 * (1 - ease);
              glowR = 30 * (1 - ease * 0.5);
              glowOp = 0.25 * (1 - ease);
              coreOp = 1.0 * (1 - ease);
            }

            nmFeatures.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [anim.lng, anim.lat] },
              properties: {
                radius: Math.max(0, ringR),
                strokeWidth: Math.max(0, strokeW),
                opacity: clamp01(opacity),
                glowRadius: Math.max(0, glowR),
                glowOpacity: clamp01(glowOp),
                coreRadius: Math.max(0, coreR),
                coreOpacity: clamp01(coreOp),
              },
            });
          }
          const nmSrc = map.getSource("new-market-rings") as maplibregl.GeoJSONSource;
          if (nmSrc) nmSrc.setData({ type: "FeatureCollection", features: nmFeatures });
        }

        // Feature 4: trade flash animations
        const flashes = tradeFlashesRef.current;
        if (flashes.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tfFeatures: any[] = [];
          const remaining: typeof flashes = [];
          for (const flash of flashes) {
            const elapsed = now - flash.startTime;
            const duration = flash.isSmart ? 2000 : 1500;
            if (elapsed > duration) continue;
            remaining.push(flash);
            const t = elapsed / duration;
            const ease = 1 - Math.pow(1 - t, 3);
            const maxR = flash.isSmart ? 30 : 20;
            const r = 4 + ease * (maxR - 4);
            const op = 0.8 * (1 - t);
            const color = flash.side === "BUY" ? "#22c55e" : "#ff4444";
            tfFeatures.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [flash.lng, flash.lat] },
              properties: { radius: r, opacity: op, color, strokeWidth: flash.isSmart ? 2.5 : 1.5, glowRadius: r * 1.4, glowOpacity: op * 0.3 },
            });
          }
          tradeFlashesRef.current = remaining;
          const tfSrc = map.getSource("trade-flashes") as maplibregl.GeoJSONSource;
          if (tfSrc) tfSrc.setData({ type: "FeatureCollection", features: tfFeatures });
        }

        // Overlay event burst animations (ripple rings on layer load)
        const bursts = overlayBurstRef.current;
        if (bursts.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const burstFeatures: any[] = [];
          const BDUR = 1600;
          overlayBurstRef.current = bursts.filter((b) => {
            const elapsed = now - b.startTime;
            if (elapsed < 0) { burstFeatures.push(null); return true; } // not started yet
            if (elapsed > BDUR) return false;
            const t = elapsed / BDUR;
            const ease = 1 - Math.pow(1 - t, 2);
            burstFeatures.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [b.lng, b.lat] },
              properties: {
                radius: 3 + ease * 30,
                opacity: clamp01(0.85 * (1 - t)),
                strokeWidth: 1.5 * (1 - t * 0.5),
                color: b.color,
              },
            });
            return true;
          });
          const bSrc = map.getSource("overlay-burst") as maplibregl.GeoJSONSource | undefined;
          if (bSrc) bSrc.setData({ type: "FeatureCollection", features: burstFeatures.filter(Boolean) });
        }

        // Closed market cross-star collapse animations
        const closedAnims = closedAnimsRef.current;
        if (closedAnims.size > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cmFeatures: any[] = [];
          const DURATION = 1800;
          for (const [id, anim] of closedAnims) {
            const elapsed = now - anim.startTime;
            if (elapsed > DURATION) { closedAnims.delete(id); continue; }
            const t = elapsed / DURATION;

            // Phase 1 (0–0.3): cross-star expands outward with bright flash
            // Phase 2 (0.3–1.0): collapses inward and fades
            let ringR: number, strokeW: number, coreR: number, opacity: number, glowR: number, glowOp: number, coreOp: number;
            if (t < 0.3) {
              const p = t / 0.3;
              const ease = 1 - Math.pow(1 - p, 2);
              ringR = 4 + ease * 24;
              strokeW = 2 + ease * 1.5;
              coreR = 3 + ease * 5;
              opacity = 0.4 + ease * 0.6;
              glowR = ringR * 1.8;
              glowOp = 0.3 + ease * 0.3;
              coreOp = 0.8 + ease * 0.2;
            } else {
              const p = (t - 0.3) / 0.7;
              const ease = p * p; // ease-in for collapse
              ringR = 28 * (1 - ease);
              strokeW = 3.5 * (1 - ease * 0.5);
              coreR = 8 * (1 - ease);
              opacity = 1.0 * (1 - ease);
              glowR = ringR * 1.8;
              glowOp = 0.6 * (1 - ease);
              coreOp = 1.0 * (1 - ease);
            }

            cmFeatures.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [anim.lng, anim.lat] },
              properties: {
                radius: Math.max(0, ringR),
                strokeWidth: Math.max(0, strokeW),
                opacity: clamp01(opacity),
                color: anim.color,
                glowRadius: Math.max(0, glowR),
                glowOpacity: clamp01(glowOp),
                coreRadius: Math.max(0, coreR),
                coreOpacity: clamp01(coreOp),
              },
            });
          }
          const cmSrc = map.getSource("closed-market-anims") as maplibregl.GeoJSONSource;
          if (cmSrc) cmSrc.setData({ type: "FeatureCollection", features: cmFeatures });
        }

        pulseRef.current = requestAnimationFrame(animatePulse);
      };
      pulseRef.current = requestAnimationFrame(animatePulse);

      // Restart RAF loop when tab becomes visible again
      const onVisChange = () => {
        if (!document.hidden) {
          cancelAnimationFrame(pulseRef.current);
          pulseRef.current = requestAnimationFrame(animatePulse);
        }
      };
      document.addEventListener("visibilitychange", onVisChange);
      map.once("remove", () => document.removeEventListener("visibilitychange", onVisChange));
    });

    return () => {
      canvas.removeEventListener("wheel", wheelHandler);
      cancelAnimationFrame(pulseRef.current);
      reducedMotionCleanup.current?.();
      map.remove();
      mapRef.current = null;
      countryLayersAdded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Generate SDF shape icons for category-shaped markers
  function generateShapeIcons(map: maplibregl.Map) {
    // 64px canvas with pixelRatio:2 → 32 logical px, crisp on retina
    const size = 64;
    const cx = size / 2;
    const cy = size / 2;
    const R = 28; // shape radius (2× of previous 14)

    const shapes: Record<string, (ctx: CanvasRenderingContext2D) => void> = {
      circle: (ctx) => {
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
      },
      star: (ctx) => {
        const outerR = R, innerR = 12, points = 5;
        for (let i = 0; i < points * 2; i++) {
          const r = i % 2 === 0 ? outerR : innerR;
          const angle = (Math.PI / 2) * -1 + (Math.PI / points) * i;
          const method = i === 0 ? "moveTo" : "lineTo";
          ctx[method](cx + r * Math.cos(angle), cy + r * Math.sin(angle));
        }
        ctx.closePath();
      },
      diamond: (ctx) => {
        ctx.moveTo(cx, cy - R);
        ctx.lineTo(cx + 22, cy);
        ctx.lineTo(cx, cy + R);
        ctx.lineTo(cx - 22, cy);
        ctx.closePath();
      },
      triangle: (ctx) => {
        ctx.moveTo(cx, cy - R);
        ctx.lineTo(cx + R * Math.cos(Math.PI / 6), cy + R * Math.sin(Math.PI / 6));
        ctx.lineTo(cx - R * Math.cos(Math.PI / 6), cy + R * Math.sin(Math.PI / 6));
        ctx.closePath();
      },
      hexagon: (ctx) => {
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          const method = i === 0 ? "moveTo" : "lineTo";
          ctx[method](cx + R * Math.cos(angle), cy + R * Math.sin(angle));
        }
        ctx.closePath();
      },
      pentagon: (ctx) => {
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
          const method = i === 0 ? "moveTo" : "lineTo";
          ctx[method](cx + R * Math.cos(angle), cy + R * Math.sin(angle));
        }
        ctx.closePath();
      },
      square: (ctx) => {
        const r = 4, s = 24;
        ctx.moveTo(cx - s + r, cy - s);
        ctx.lineTo(cx + s - r, cy - s);
        ctx.arcTo(cx + s, cy - s, cx + s, cy - s + r, r);
        ctx.lineTo(cx + s, cy + s - r);
        ctx.arcTo(cx + s, cy + s, cx + s - r, cy + s, r);
        ctx.lineTo(cx - s + r, cy + s);
        ctx.arcTo(cx - s, cy + s, cx - s, cy + s - r, r);
        ctx.lineTo(cx - s, cy - s + r);
        ctx.arcTo(cx - s, cy - s, cx - s + r, cy - s, r);
        ctx.closePath();
      },
    };

    // Pre-generate colored icons for every color × shape combo (non-SDF)
    const allColors = [
      ...Object.values(CATEGORY_COLORS),
      ...Object.values(IMPACT_COLORS),
    ];
    const uniqueColors = [...new Set(allColors)];

    for (const [shapeName, draw] of Object.entries(shapes)) {
      for (const color of uniqueColors) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;

        // Colored fill
        ctx.beginPath();
        draw(ctx);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fill();

        // Dark outline on top — visible against the colored fill
        ctx.globalAlpha = 1;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
        ctx.stroke();

        const imageData = ctx.getImageData(0, 0, size, size);
        const key = `icon-${color.replace("#", "")}-${shapeName}`;
        map.addImage(key, imageData, { sdf: false, pixelRatio: 2 });
      }
    }
  }

  // Rasterize an emoji string onto a canvas and return raw RGBA data for map.addImage()
  function emojiToSprite(emoji: string, size = 24): { width: number; height: number; data: Uint8Array } {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.font = `${Math.round(size * 0.72)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, size / 2, size / 2 + 1);
    const imgData = ctx.getImageData(0, 0, size, size);
    return { width: size, height: size, data: new Uint8Array(imgData.data.buffer) };
  }

  function generateMarketEmojiIcons(map: maplibregl.Map) {
    // Category emojis
    for (const [cat, emoji] of Object.entries(CATEGORY_EMOJI)) {
      const key = `market-emoji-${cat}`;
      if (map.hasImage(key)) continue;
      const sprite = emojiToSprite(emoji, 48);
      map.addImage(key, sprite, { sdf: false, pixelRatio: 2 });
    }
    // Sub-category emojis (keyed by emoji itself)
    for (const emoji of ALL_SUB_EMOJIS) {
      const key = `market-sub-${emoji}`;
      if (map.hasImage(key)) continue;
      const sprite = emojiToSprite(emoji, 48);
      map.addImage(key, sprite, { sdf: false, pixelRatio: 2 });
    }
  }

  // Add overlay GeoJSON sources + emoji sprite layers (all hidden initially)
  function addOverlayLayers(map: maplibregl.Map, beforeId?: string) {
    const configs: { id: OverlayLayer; color: string; glowR: number; emoji: string }[] = [
      { id: "conflicts",  color: "#ef4444", glowR: 28, emoji: "💥" },
      { id: "intel",      color: "#a855f7", glowR: 22, emoji: "🔍" },
      { id: "military",   color: "#22d3ee", glowR: 16, emoji: "✈️" },
      { id: "weather",    color: "#f59e0b", glowR: 26, emoji: "🌩️" },
      { id: "natural",    color: "#f97316", glowR: 26, emoji: "🌍" },
      { id: "fires",      color: "#ff6b35", glowR: 20, emoji: "🔥" },
      { id: "elections",  color: "#fbbf24", glowR: 24, emoji: "🗳️" },
      { id: "outages",    color: "#e879f9", glowR: 26, emoji: "📡" },
      { id: "protests",   color: "#fb7185", glowR: 22, emoji: "✊" },
      { id: "soccer",     color: "#10b981", glowR: 22, emoji: "⚽" },
      { id: "basketball", color: "#f97316", glowR: 22, emoji: "🏀" },
      { id: "baseball",   color: "#ef4444", glowR: 20, emoji: "⚾" },
      { id: "hockey",     color: "#38bdf8", glowR: 20, emoji: "🏒" },
      { id: "tennis",     color: "#a3e635", glowR: 18, emoji: "🎾" },
      { id: "golf",       color: "#4ade80", glowR: 18, emoji: "⛳" },
      { id: "combat",     color: "#f43f5e", glowR: 22, emoji: "🥊" },
    ];

    const add = (layer: Parameters<typeof map.addLayer>[0]) => map.addLayer(layer, beforeId);

    for (const { id, color, glowR, emoji } of configs) {
      // Register the emoji as a map image sprite so icon-image can render it in full color
      const spriteId = `overlay-${id}-icon`;
      if (!map.hasImage(spriteId)) {
        map.addImage(spriteId, emojiToSprite(emoji));
      }

      map.addSource(`overlay-${id}`, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      add({
        id: `overlay-${id}-glow`,
        type: "circle",
        source: `overlay-${id}`,
        minzoom: 2,
        layout: { visibility: "none" },
        paint: {
          "circle-color": color,
          "circle-radius": Math.round(glowR * 0.7),
          "circle-opacity": 0.08,
          "circle-blur": 1.8,
        },
      });
      add({
        id: `overlay-${id}-dot`,
        type: "symbol",
        source: `overlay-${id}`,
        minzoom: 2,
        layout: {
          visibility: "none",
          "icon-image": spriteId,
          "icon-size": 0.5,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-anchor": "center",
        } as maplibregl.SymbolLayerSpecification["layout"],
        paint: { "icon-opacity": 0.55 },
      });

      // Hover tooltip
      map.on("mouseenter", `overlay-${id}-dot`, (e) => {
        map.getCanvas().style.cursor = "pointer";
        // Suppress country popup while hovering an overlay point
        if (countryHoverTimer.current) { clearTimeout(countryHoverTimer.current); countryHoverTimer.current = null; }
        setHoverCountry(null);
        if (!e.features?.length) return;
        const props = e.features[0].properties ?? {};
        const canvas = map.getCanvas().getBoundingClientRect();
        const rows: { label: string; value: string }[] = [];
        if (props.date)     rows.push({ label: "date",    value: String(props.date) });
        if (props.country)  rows.push({ label: "country", value: String(props.country) });
        if (props.deaths !== undefined && Number(props.deaths) > 0)
                            rows.push({ label: "deaths",  value: String(props.deaths) });
        if (props.sport)    rows.push({ label: "sport",   value: String(props.sport) });
        if (props.venue)    rows.push({ label: "venue",   value: String(props.venue) });
        if (props.city)     rows.push({ label: "city",    value: String(props.city) });
        if (props.type && !["soccer","basketball","baseball","hockey","tennis","golf","combat"].includes(id))
                            rows.push({ label: "type",    value: String(props.type) });
        if (props.altitude) rows.push({ label: "alt",     value: `${Math.round(Number(props.altitude) / 100) * 100} ft` });
        if (props.speed)    rows.push({ label: "speed",   value: `${Math.round(Number(props.speed))} kts` });
        if (props.duration) rows.push({ label: "duration", value: String(props.duration) });
        setHoverOverlay({
          layerId: id,
          color,
          title: String(props.title || id).slice(0, 80),
          rows,
          x: canvas.left + e.point.x,
          y: canvas.top  + e.point.y,
        });
      });
      map.on("mouseleave", `overlay-${id}-dot`, () => {
        map.getCanvas().style.cursor = "";
        setHoverOverlay(null);
      });
    }

    // Burst ripple rings — rendered on top of everything (no beforeId)
    map.addSource("overlay-burst", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "overlay-burst-ring",
      type: "circle",
      source: "overlay-burst",
      paint: {
        "circle-color": "transparent",
        "circle-radius": ["get", "radius"],
        "circle-stroke-width": ["get", "strokeWidth"],
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-opacity": ["get", "opacity"],
      },
    });
  }

  // Add GeoJSON source + layers for markets (no MapLibre clustering — we handle it ourselves)
  // beforeId: insert all market layers below this layer (typically the first label layer)
  function addMarketLayers(map: maplibregl.Map, beforeId?: string) {
    map.addSource("markets", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    // Helper: insert below labels
    const add = (layer: Parameters<typeof map.addLayer>[0]) =>
      map.addLayer(layer, beforeId);

    // --- CLUSTER LAYERS ---

    // Cluster soft glow — warm tinted
    add({
      id: "clusters-glow",
      type: "circle",
      source: "markets",
      filter: ["has", "point_count"],
      maxzoom: 8,
      paint: {
        "circle-color": "#4a8c6a",
        "circle-radius": [
          "step", ["get", "point_count"],
          12, 5, 16, 15, 20, 50, 24,
        ],
        "circle-opacity": [
          "interpolate", ["linear"], ["zoom"],
          1.5, 0.1,
          4, 0.2,
        ],
        "circle-blur": 1,
      },
    });

    // Cluster dot — tinted fill instead of black
    add({
      id: "clusters",
      type: "circle",
      source: "markets",
      filter: ["has", "point_count"],
      maxzoom: 8,
      paint: {
        "circle-color": "#1e3a2f",
        "circle-radius": [
          "step", ["get", "point_count"],
          10, 10, 14, 50, 18,
        ],
        "circle-opacity": 1,
        "circle-stroke-width": 0.5,
        "circle-stroke-color": "rgba(34, 197, 94, 0.25)",
      },
    });

    // Cluster count labels
    add({
      id: "cluster-count",
      type: "symbol",
      source: "markets",
      filter: ["has", "point_count"],
      maxzoom: 8,
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-size": [
          "step", ["get", "point_count"],
          9, 10, 10, 50, 11,
        ],
        "text-font": ["Open Sans Bold"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": [
          "interpolate", ["linear"], ["zoom"],
          1.5, "rgba(34, 197, 94, 0.5)",
          5, "rgba(34, 197, 94, 0.8)",
        ],
      },
    });

    // --- INDIVIDUAL MARKER LAYERS ---

    // Breathing glow behind market emoji icons
    add({
      id: "market-breathe-glow",
      type: "circle",
      source: "markets",
      filter: ["!", ["has", "point_count"]],
      minzoom: 3,
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          1.5, 6,
          4, 10,
          8, 16,
        ],
        "circle-opacity": 0.12,
        "circle-blur": 1.2,
      },
    });

    // Core emoji icon — category-based
    add({
      id: "unclustered-point",
      type: "symbol",
      source: "markets",
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": [
          "case",
          ["!=", ["get", "subEmoji"], ""],
            ["concat", "market-sub-", ["get", "subEmoji"]],
          ["concat", "market-emoji-", ["get", "category"]],
        ],
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          1.5, 0.5,
          4,   0.65,
          8,   0.8,
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-z-order": "source",
        "symbol-sort-key": ["*", ["get", "radius"], -1],  // larger markets on top
      },
      paint: {
        "icon-opacity": 1,
      },
    });

    // Signal glow (pulsing via rAF) — proportional radius
    add({
      id: "signal-glow",
      type: "circle",
      source: "markets",
      filter: ["all", ["!", ["has", "point_count"]], ["get", "hasSignal"]],
      minzoom: 2,
      paint: {
        "circle-color": ["get", "signalColor"],
        "circle-radius": ["get", "signalRadius"],
        "circle-opacity": 0.15,
        "circle-blur": 1,
      },
    });

    // Signal pulse ring (outer) — double-ring radar ping effect
    add({
      id: "signal-pulse-ring",
      type: "circle",
      source: "markets",
      filter: ["all", ["!", ["has", "point_count"]], ["get", "hasSignal"]],
      minzoom: 2,
      paint: {
        "circle-color": "transparent",
        "circle-radius": ["+", ["get", "signalRadius"], 4],
        "circle-stroke-width": 0.6,
        "circle-stroke-color": ["get", "signalColor"],
        "circle-stroke-opacity": 0.1,
      },
    });

    // Anomaly glow — amber pulse for anomalous markets
    add({
      id: "anomaly-glow",
      type: "circle",
      source: "markets",
      filter: ["all", ["!", ["has", "point_count"]], ["get", "isAnomaly"]],
      minzoom: 2,
      paint: {
        "circle-color": "#f59e0b",
        "circle-radius": ["+", ["get", "radius"], 6],
        "circle-opacity": 0.12,
        "circle-blur": 1,
      },
    });

    // Selected market ring — persistent green pulse + faint glow fill
    add({
      id: "selected-ring",
      type: "circle",
      source: "markets",
      filter: ["all", ["!", ["has", "point_count"]], ["get", "isSelected"]],
      paint: {
        "circle-color": "#22c55e",
        "circle-opacity": 0.04,
        "circle-radius": ["+", ["get", "radius"], 4],
        "circle-stroke-width": 1.2,
        "circle-stroke-color": "#22c55e",
        "circle-stroke-opacity": 0.7,
      },
    });

    // Selected market beacon — outer concentric ring, half-speed pulse
    add({
      id: "selected-beacon",
      type: "circle",
      source: "markets",
      filter: ["all", ["!", ["has", "point_count"]], ["get", "isSelected"]],
      minzoom: 2,
      paint: {
        "circle-color": "transparent",
        "circle-radius": ["+", ["get", "radius"], 10],
        "circle-stroke-width": 0.8,
        "circle-stroke-color": "#22c55e",
        "circle-stroke-opacity": 0.15,
      },
    });

    // Hover highlight ring — activated via feature-state
    add({
      id: "marker-hover",
      type: "circle",
      source: "markets",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "transparent",
        "circle-radius": ["+", ["get", "radius"], 2],
        "circle-stroke-width": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          1.2,
          0,
        ],
        "circle-stroke-color": "rgba(34, 197, 94, 0.5)",
      },
    });

    // --- NEW MARKET RING SOURCE (Feature 2) ---
    map.addSource("new-market-rings", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    add({
      id: "new-market-glow",
      type: "circle",
      source: "new-market-rings",
      paint: {
        "circle-color": "#22c55e",
        "circle-radius": ["get", "glowRadius"],
        "circle-opacity": ["get", "glowOpacity"],
        "circle-blur": 1,
      },
    });
    add({
      id: "new-market-ring",
      type: "circle",
      source: "new-market-rings",
      paint: {
        "circle-color": "transparent",
        "circle-radius": ["get", "radius"],
        "circle-stroke-width": ["get", "strokeWidth"],
        "circle-stroke-color": "#22c55e",
        "circle-stroke-opacity": ["get", "opacity"],
      },
    });
    add({
      id: "new-market-core",
      type: "circle",
      source: "new-market-rings",
      paint: {
        "circle-color": "#22c55e",
        "circle-radius": ["get", "coreRadius"],
        "circle-opacity": ["get", "coreOpacity"],
      },
    });

    // --- TRADE FLASH SOURCE (Feature 4) ---
    map.addSource("trade-flashes", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    add({
      id: "trade-flash-glow",
      type: "circle",
      source: "trade-flashes",
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": ["get", "glowRadius"],
        "circle-opacity": ["get", "glowOpacity"],
        "circle-blur": 1,
      },
    });
    add({
      id: "trade-flash-ring",
      type: "circle",
      source: "trade-flashes",
      paint: {
        "circle-color": "transparent",
        "circle-radius": ["get", "radius"],
        "circle-stroke-width": ["get", "strokeWidth"],
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-opacity": ["get", "opacity"],
      },
    });

    // --- CLOSED MARKET COLLAPSE ANIMATION ---
    map.addSource("closed-market-anims", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    // Cross-star arms (4 lines radiating outward, then collapsing)
    add({
      id: "closed-star-glow",
      type: "circle",
      source: "closed-market-anims",
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": ["get", "glowRadius"],
        "circle-opacity": ["get", "glowOpacity"],
        "circle-blur": 1,
      },
    });
    add({
      id: "closed-star-ring",
      type: "circle",
      source: "closed-market-anims",
      paint: {
        "circle-color": "transparent",
        "circle-radius": ["get", "radius"],
        "circle-stroke-width": ["get", "strokeWidth"],
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-opacity": ["get", "opacity"],
      },
    });
    add({
      id: "closed-star-core",
      type: "circle",
      source: "closed-market-anims",
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": ["get", "coreRadius"],
        "circle-opacity": ["get", "coreOpacity"],
      },
    });

    // --- INTERACTIONS ---

    // Click continent cluster → zoom past threshold to show individual bubbles
    map.on("click", "clusters", (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
      if (!features.length) return;
      const geom = features[0].geometry;
      if (geom.type === "Point") {
        map.easeTo({ center: geom.coordinates as [number, number], zoom: ZOOM_TIER_THRESHOLDS[0] + 0.5 });
      }
    });

    // Click individual → desktop: select market; mobile: show preview popup above icon
    map.on("click", "unclustered-point", (e) => {
      if (!e.features?.length) return;
      const props = e.features[0].properties;
      const geom = e.features[0].geometry;
      if (!props || geom.type !== "Point") return;
      const market = marketsLookup.current.get(props.marketId);
      if (!market) return;

      const mobile = window.innerWidth <= 768;
      // Always select the market so detail panel tracks it
      if (onMarketClick) onMarketClick(market);
      if (mobile) {
        // Show popup above the tapped icon
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        const pw = Math.min(300, window.innerWidth - 16);
        const maxH = 360;
        const gap = 20;
        const point = e.point;
        const canvas = map.getCanvas().getBoundingClientRect();
        const screenX = canvas.left + point.x;
        const screenY = canvas.top + point.y;
        let left = screenX - pw / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
        // Prefer above icon (bottom-anchored so it hugs the icon); fall back to below
        const spaceAbove = screenY - canvas.top;
        if (spaceAbove > 120) {
          // Bottom of popup = 6px above icon
          const bottom = window.innerHeight - screenY + gap;
          setHoverMarket(market);
          setHoverPos({ bottom, left });
        } else {
          const top = screenY + gap + 16; // 16 ≈ icon size
          setHoverMarket(market);
          setHoverPos({ top, left });
        }
      } else {
        // Desktop: dismiss hover popup, detail panel will show
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        setHoverMarket(null);
        setHoverPos(null);
      }
    });

    // Tap elsewhere on map → dismiss mobile popups
    map.on("click", (e) => {
      if (window.innerWidth > 768) return;
      const features = map.queryRenderedFeatures(e.point, { layers: ["unclustered-point"] });
      if (features.length > 0) return; // tapped a marker, handled above
      setHoverMarket(null);
      setHoverPos(null);
      if (onMapTap) onMapTap();
    });

    // Hover: feature-state highlight + cursor + preview popup
    let hoveredId: string | number | null = null;
    let hoveredMarketId: string | null = null;

    const updateHover = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return;
      const feature = e.features[0];
      const id = feature.id;
      const props = feature.properties;
      const marketId = props?.marketId as string | undefined;

      // Same feature — skip
      if (marketId && marketId === hoveredMarketId) return;

      // Clear previous highlight
      if (hoveredId !== null) {
        map.setFeatureState({ source: "markets", id: hoveredId }, { hover: false });
        hoveredId = null;
      }

      // Set new highlight
      if (id !== undefined && id !== null) {
        hoveredId = id;
        map.setFeatureState({ source: "markets", id: hoveredId }, { hover: true });
      }

      hoveredMarketId = marketId ?? null;

      if (marketId) {
        const market = marketsLookup.current.get(marketId);
        if (market && market.id !== selectedMarketIdRef.current) {
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          if (countryHoverTimer.current) clearTimeout(countryHoverTimer.current);
          setHoverCountry(null);
          const showPopup = () => {
            const point = e.point;
            const canvas = map.getCanvas().getBoundingClientRect();
            const screenX = canvas.left + point.x;
            const screenY = canvas.top + point.y;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            let left = screenX + 16;
            if (left + PREVIEW_W > vw - 4) {
              left = screenX - PREVIEW_W - 16;
            }
            left = Math.max(4, Math.min(left, vw - PREVIEW_W - 4));
            let top = screenY - 40;
            top = Math.max(4, Math.min(top, vh - PREVIEW_MAX_H - 4));
            setHoverMarket(market);
            setHoverPos({ top, left });
          };
          // If a popup is already showing, switch immediately; otherwise delay
          if (hoverMarketRef.current) {
            showPopup();
          } else {
            hoverTimer.current = setTimeout(showPopup, 350);
          }
        }
      }
    };

    map.on("mouseenter", "unclustered-point", (e) => {
      map.getCanvas().style.cursor = "pointer";
      updateHover(e);
    });
    map.on("mousemove", "unclustered-point", updateHover);
    map.on("mouseleave", "unclustered-point", () => {
      map.getCanvas().style.cursor = "";
      hoveredMarketId = null;
      if (hoveredId !== null) {
        map.setFeatureState({ source: "markets", id: hoveredId }, { hover: false });
        hoveredId = null;
      }
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      // Delay dismiss so user can move mouse to the popup
      hoverTimer.current = setTimeout(() => {
        hoverTimer.current = null;
        setHoverMarket(null);
        setHoverPos(null);
      }, 300);
    });
    map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });
  }

  // Add country boundary hover/highlight interaction
  function addCountryInteraction(map: maplibregl.Map) {
    if (countryLayersAdded.current) return;
    countryLayersAdded.current = true;

    // Use topojson country boundaries
    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
      .then((r) => r.json())
      .then((topology) => {
        // Convert TopoJSON to GeoJSON (with antimeridian fix)
        const countries = topojsonFeature(topology, topology.objects.countries);
        // Keep Taiwan in geo features but treat as part of China for selection
        if (!map.getSource("country-boundaries")) {
          map.addSource("country-boundaries", {
            type: "geojson",
            data: countries,
          });

          // Invisible interactive layer (for hover detection)
          map.addLayer(
            {
              id: "country-fills",
              type: "fill",
              source: "country-boundaries",
              paint: {
                "fill-color": "#888",
                "fill-opacity": 0,
              },
            },
            "clusters" // insert below market layers
          );

          // Hover highlight
          map.addLayer(
            {
              id: "country-hover",
              type: "fill",
              source: "country-boundaries",
              paint: {
                "fill-color": "#fff",
                "fill-opacity": 0.03,
              },
              filter: ["==", ["get", "name"], ""],
            },
            "clusters"
          );

          // Border highlight on hover
          map.addLayer(
            {
              id: "country-hover-border",
              type: "line",
              source: "country-boundaries",
              paint: {
                "line-color": "#555",
                "line-width": 0.8,
                "line-opacity": 0.5,
              },
              filter: ["==", ["get", "name"], ""],
            },
            "clusters"
          );

          // Selected country: persistent green fill
          map.addLayer(
            {
              id: "country-selected",
              type: "fill",
              source: "country-boundaries",
              paint: {
                "fill-color": "rgba(34,197,94,0.08)",
                "fill-opacity": 1,
              },
              filter: ["==", ["get", "name"], ""],
            },
            "clusters"
          );

          // Selected country: green border
          map.addLayer(
            {
              id: "country-selected-border",
              type: "line",
              source: "country-boundaries",
              paint: {
                "line-color": "#22c55e",
                "line-width": 1.5,
                "line-opacity": 0.8,
              },
              filter: ["==", ["get", "name"], ""],
            },
            "clusters"
          );
        }

        applySelectedCountryHighlight(map);

        // Mouse interaction
        let hoveredName: string | null = null;

        map.on("mousemove", "country-fills", (e) => {
          const feat = e.features?.[0];
          const name = feat?.properties?.name as string | undefined;
          // If hovering over a market icon, suppress country hover entirely
          const marketFeatures = map.queryRenderedFeatures(e.point, { layers: ["unclustered-point"] });
          if (marketFeatures.length > 0) {
            if (countryHoverTimer.current) clearTimeout(countryHoverTimer.current);
            setHoverCountry(null);
            if (hoveredName) {
              hoveredName = null;
              map.setFilter("country-hover", ["==", ["get", "name"], ""]);
              map.setFilter("country-hover-border", ["==", ["get", "name"], ""]);
            }
            return;
          }
          clearHoverPopup();
          if (name && name !== hoveredName) {
            hoveredName = name;
            map.setFilter("country-hover", ["==", ["get", "name"], name]);
            map.setFilter("country-hover-border", ["==", ["get", "name"], name]);
            if (countryHoverTimer.current) clearTimeout(countryHoverTimer.current);
            const { x, y } = e.point;
            countryHoverTimer.current = setTimeout(() => {
              if (window.innerWidth > 768) setHoverCountry({ name, x, y });
            }, 800);
          }
        });

        map.on("mouseleave", "country-fills", () => {
          hoveredName = null;
          map.setFilter("country-hover", ["==", ["get", "name"], ""]);
          map.setFilter("country-hover-border", ["==", ["get", "name"], ""]);
          if (countryHoverTimer.current) clearTimeout(countryHoverTimer.current);
          setHoverCountry(null);
        });

        // Country click → callback (skip if a market icon was clicked, or mobile popup is active)
        map.on("click", "country-fills", (e) => {
          const marketHit = map.queryRenderedFeatures(e.point, { layers: ["unclustered-point"] });
          if (marketHit.length > 0) return;
          // Mobile: if a market popup is showing, just dismiss it — don't trigger country navigation
          if (window.innerWidth <= 768 && hoverMarketRef.current) return;

          const feat = e.features?.[0];
          const name = feat?.properties?.name as string | undefined;
          if (name && onCountryClick) {
            onCountryClick(name);
          }

          // Zoom to the clicked country's bounding box
          if (feat?.geometry) {
            const bounds = new maplibregl.LngLatBounds();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const addRing = (ring: any[]) => {
              for (const c of ring) bounds.extend([c[0] as number, c[1] as number]);
            };
            const geom = feat.geometry as { type: string; coordinates: unknown[] };
            if (geom.type === "Polygon") {
              for (const ring of geom.coordinates as number[][][]) addRing(ring);
            } else if (geom.type === "MultiPolygon") {
              for (const poly of geom.coordinates as number[][][][])
                for (const ring of poly) addRing(ring);
            }
            if (!bounds.isEmpty()) {
              map.fitBounds(bounds, { padding: 48, duration: 1200, maxZoom: 6 });
            }
          }
        });
      })
      .catch((err) => console.warn("Failed to load country boundaries:", err));
  }


  // Update GeoJSON source when data/filters change
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const source = map.getSource("markets") as maplibregl.GeoJSONSource;
    if (!source) return;

    const filtered = markets.filter((m) => activeCategories.has(m.category));

    marketsLookup.current.clear();
    for (const m of filtered) {
      marketsLookup.current.set(m.id, m);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let features: any[];

    if (currentTier === 0) {
      // --- Tier 0: continent aggregates ---
      const groups = new Map<string, { lats: number[]; lngs: number[]; count: number }>();
      for (const m of filtered) {
        if (!m.coords) continue;
        const key = getGroupKey(m, 0);
        const g = groups.get(key);
        if (g) { g.lats.push(m.coords[0]); g.lngs.push(m.coords[1]); g.count++; }
        else groups.set(key, { lats: [m.coords[0]], lngs: [m.coords[1]], count: 1 });
      }
      features = Array.from(groups.entries()).map(([key, g], i) => ({
        type: "Feature" as const,
        id: i,
        geometry: {
          type: "Point" as const,
          coordinates: [
            g.lngs.reduce((a, b) => a + b, 0) / g.count,
            g.lats.reduce((a, b) => a + b, 0) / g.count,
          ],
        },
        properties: {
          point_count: g.count,
          point_count_abbreviated: g.count >= 1000 ? `${(g.count / 1000).toFixed(1)}k` : String(g.count),
          continent: key,
        },
      }));
    } else {
      // --- Tier 1: individual markets ---
      const spaced = offsetColocated(filtered);

      // Compute log+sqrt area-proportional sizing (2–10px)
      const volumes = spaced.filter((m) => m.coords).map((m) => m.volume24h || m.volume || 0);
      volumes.sort((a, b) => a - b);

      const minR = 2, maxR = 10;
      const logMin = Math.log1p(volumes[0] || 0);
      const logMax = Math.log1p(volumes[volumes.length - 1] || 1);

      features = spaced
        .filter((m) => m.coords)
        .map((m, i) => {
          const color = colorMode === "impact"
            ? IMPACT_COLORS[m.impactLevel as ImpactLevel] || IMPACT_COLORS.info
            : CATEGORY_COLORS[m.category] || CATEGORY_COLORS.Other;
          const vol = m.volume24h || m.volume || 0;

          const logVol = Math.log1p(vol);
          const t = logMax > logMin ? (logVol - logMin) / (logMax - logMin) : 0;
          const radius = minR + Math.sqrt(t) * (maxR - minR);
          const glowIntensity = 0.12 + t * 0.3;

          const change = m.change ?? 0;
          const hasSignal = m.change !== null && Math.abs(m.change) > 0.05;
          const signalColor =
            m.change !== null && m.change > 0 ? "#22c55e" : "#ff4444";
          const signalRadius = hasSignal
            ? radius + 3 + Math.min(5, Math.abs(change) * 50)
            : 0;

          const isAnomaly = m.anomaly?.isAnomaly ?? false;
          const isSelected = m.id === selectedMarketId;

          return {
            type: "Feature" as const,
            id: i,
            geometry: {
              type: "Point" as const,
              coordinates: [m.coords![1], m.coords![0]],
            },
            properties: {
              marketId: m.id,
              color,
              radius,
              vol24h: vol,
              glowIntensity,
              hasSignal,
              signalColor,
              signalRadius,
              isAnomaly,
              isSelected,
              shape: CATEGORY_SHAPES[m.category] || "circle",
              category: m.category || "Other",
              subEmoji: detectSubEmoji(m.category, m.title, m.description) || "",
            },
          };
        });
    }

    source.setData({ type: "FeatureCollection", features });

    // Detect disappeared markets → trigger cross-star collapse animation
    // Skip when tier changes (all features change shape, not actual market closures)
    const tierChanged = currentTier !== prevTierRef.current;
    prevTierRef.current = currentTier;

    if (!tierChanged && currentTier === 1) {
      const currentIds = new Map<string, { lng: number; lat: number; color: string }>();
      for (const f of features) {
        if (f.properties.marketId) {
          currentIds.set(f.properties.marketId, {
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
            color: f.properties.color,
          });
        }
      }
      const now = performance.now();
      for (const [id, pos] of prevMarketIdsRef.current) {
        if (!currentIds.has(id) && !closedAnimsRef.current.has(id)) {
          closedAnimsRef.current.set(id, { startTime: now, ...pos });
        }
      }
      // Cap closed animations map
      if (closedAnimsRef.current.size > 100) {
        const it = closedAnimsRef.current.keys();
        while (closedAnimsRef.current.size > 100) closedAnimsRef.current.delete(it.next().value!);
      }
      prevMarketIdsRef.current = currentIds;
    } else if (tierChanged) {
      // Reset tracking on tier change
      prevMarketIdsRef.current = new Map();
    }
  }, [markets, activeCategories, mapReady, colorMode, selectedMarketId, currentTier]);

  // Update selected country highlight
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    applySelectedCountryHighlight(mapRef.current);
  }, [selectedCountry, mapReady, currentTier, applySelectedCountryHighlight]);

  // Region flyTo
  useEffect(() => {
    if (!mapReady || !mapRef.current || !region) return;
    const view = REGIONAL_VIEWS.find((r) => r.id === region);
    if (!view) return;
    mapRef.current.flyTo({
      center: view.center,
      zoom: view.zoom,
      duration: 1200,
    });
  }, [region, mapReady]);

  // Fly to target — then auto-expand cluster and center on the actual bubble
  useEffect(() => {
    if (!flyToTarget || !mapRef.current) return;
    const map = mapRef.current;
    let cancelled = false;

    // Cancel any in-progress animation to prevent re-entrant render
    if (map.isMoving()) {
      map.stop();
    }

    // Use offset-colocated coords (actual bubble position) when available
    const looked = marketsLookup.current.get(flyToTarget.marketId);
    const bubbleCoords: [number, number] = looked?.coords
      ? [looked.coords[1], looked.coords[0]]
      : [flyToTarget.coords[1], flyToTarget.coords[0]];
    // Raw coords for initial flyTo (close enough to find the cluster)
    const rawCenter: [number, number] = [flyToTarget.coords[1], flyToTarget.coords[0]];
    const currentZoom = map.getZoom();
    // Only zoom in if viewing from far away; otherwise just pan
    const targetZoom = currentZoom >= 4 ? currentZoom : 5;

    // On mobile with bottom panel, offset center upward so icon stays in visible map area
    const mobile = window.innerWidth <= 768;
    const padBottom = mobile ? window.innerHeight * 0.4 : 0; // 40dvh panel
    const padding = padBottom > 0 ? { top: 0, left: 0, right: 0, bottom: padBottom } : undefined;

    // If the target is already near screen center, skip the fly animation
    const screenPt = map.project(rawCenter);
    const canvas = map.getCanvas();
    const cx = canvas.width / (2 * devicePixelRatio);
    const cy = canvas.height / (2 * devicePixelRatio);
    const dist = Math.hypot(screenPt.x - cx, screenPt.y - cy);
    const nearCenter = dist < 120 && Math.abs(targetZoom - currentZoom) < 0.5;

    if (nearCenter) {
      map.jumpTo({ center: rawCenter, zoom: targetZoom, ...(padding && { padding }) });
    } else {
      map.flyTo({ center: rawCenter, zoom: targetZoom, duration: 1500, ...(padding && { padding }) });
    }

    // After flyTo completes, ensure the bubble is visible and centered
    const onMoveEnd = () => {
      if (cancelled) return;
      const point = map.project(rawCenter);
      const unclustered = map.queryRenderedFeatures(point, { layers: ["unclustered-point"] });
      const visible = unclustered.some((f) => f.properties?.marketId === flyToTarget.marketId);
      if (visible) {
        // Bubble visible but may be off-center due to offset — recenter
        if (bubbleCoords[0] !== rawCenter[0] || bubbleCoords[1] !== rawCenter[1]) {
          map.easeTo({ center: bubbleCoords, duration: 400, ...(padding && { padding }) });
        }
        return;
      }

      // Market still in continent cluster — zoom in just enough to uncluster,
      // but never zoom OUT from where the animation landed
      const postAnimZoom = map.getZoom();
      const minUncluster = ZOOM_TIER_THRESHOLDS[0] + 0.5;
      map.easeTo({ center: bubbleCoords, zoom: Math.max(minUncluster, postAnimZoom), duration: 800, ...(padding && { padding }) });
    };
    map.once("moveend", onMoveEnd);

    return () => {
      cancelled = true;
      map.off("moveend", onMoveEnd);
    };
  }, [flyToTarget]);

  // Feature 2: Track new market appearance animations
  useEffect(() => {
    if (!newMarkets || newMarkets.length === 0) return;
    const now = performance.now();
    for (const m of newMarkets) {
      if (newMarketAnimRef.current.has(m.id)) continue;
      // Use offset-adjusted coords from marketsLookup when available
      const looked = marketsLookup.current.get(m.id);
      const coords = looked?.coords || m.coords;
      if (!coords) continue;
      newMarketAnimRef.current.set(m.id, {
        startTime: now,
        lng: coords[1],
        lat: coords[0],
      });
    }
    // Cap new market animations map
    if (newMarketAnimRef.current.size > 100) {
      const it = newMarketAnimRef.current.keys();
      while (newMarketAnimRef.current.size > 100) newMarketAnimRef.current.delete(it.next().value!);
    }
  }, [newMarkets]);

  // Feature 4: Track whale trade flash animations
  useEffect(() => {
    if (!whaleTrades || whaleTrades.length === 0) return;
    for (const trade of whaleTrades) {
      const key = `${trade.wallet}:${trade.conditionId}:${trade.timestamp}`;
      if (seenTradeKeysRef.current.has(key)) continue;
      seenTradeKeysRef.current.add(key);
      // Resolve coords via slug→market lookup (offset-adjusted coords)
      let market: ProcessedMarket | undefined;
      for (const m of marketsLookup.current.values()) {
        if (m.slug === trade.slug) { market = m; break; }
      }
      if (!market?.coords) continue;
      tradeFlashesRef.current.push({
        key,
        lng: market.coords[1],
        lat: market.coords[0],
        startTime: performance.now(),
        side: trade.side,
        isSmart: trade.isSmartWallet,
      });
    }
    // Cap animation array to prevent unbounded memory growth
    if (tradeFlashesRef.current.length > 100) tradeFlashesRef.current.splice(0, tradeFlashesRef.current.length - 100);
    // Prune dedup set to prevent unbounded memory growth
    if (seenTradeKeysRef.current.size > 500) {
      const keep = new Set<string>();
      for (const trade of whaleTrades) {
        keep.add(`${trade.wallet}:${trade.conditionId}:${trade.timestamp}`);
      }
      seenTradeKeysRef.current = keep;
    }
  }, [whaleTrades, markets]);

  // Overlay layer visibility + data fetching
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const active = activeLayers ?? new Set<OverlayLayer>();
    const ALL: OverlayLayer[] = ["conflicts", "intel", "military", "weather", "natural", "fires", "elections", "outages", "protests", "soccer", "basketball", "baseball", "hockey", "tennis", "golf", "combat"];

    for (const id of ALL) {
      const vis = active.has(id) ? "visible" : "none";
      const glowId = `overlay-${id}-glow`;
      const dotId  = `overlay-${id}-dot`;
      if (map.getLayer(glowId)) map.setLayoutProperty(glowId, "visibility", vis);
      if (map.getLayer(dotId))  map.setLayoutProperty(dotId,  "visibility", vis);

      if (active.has(id) && !overlayFetched.current.has(id)) {
        overlayFetched.current.add(id);
        fetchOverlayData(id).then((data) => {
          const src = mapRef.current?.getSource(`overlay-${id}`) as maplibregl.GeoJSONSource | undefined;
          if (src) {
            src.setData(data);
            const count = data.features.length;
            if (count > 0) {
              const meta = OVERLAY_META[id];
              if (meta) {
                // Show alert banner
                if (layerAlertTimerRef.current) clearTimeout(layerAlertTimerRef.current);
                setLayerAlert({ emoji: meta.emoji, label: meta.label, count, color: meta.color });
                layerAlertTimerRef.current = setTimeout(() => setLayerAlert(null), 4000);
                // Queue staggered burst rings at each event point (cap at 40)
                const t0 = performance.now();
                data.features.slice(0, 40).forEach((feat, i) => {
                  const coords = (feat.geometry as GeoJSON.Point).coordinates;
                  overlayBurstRef.current.push({
                    lng: coords[0], lat: coords[1],
                    startTime: t0 + i * 40,
                    color: meta.color,
                  });
                });
                // Cap burst array
                if (overlayBurstRef.current.length > 200) overlayBurstRef.current.splice(0, overlayBurstRef.current.length - 200);
              }
            }
          }
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayers, mapReady]);

  // Global click listener for popup star buttons
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const btn = target.closest("[data-watch-market]") as HTMLElement | null;
      if (btn && onToggleWatch) {
        const marketId = btn.getAttribute("data-watch-market");
        if (marketId) {
          onToggleWatch(marketId);
          // Update button visual immediately
          const watched = isWatched?.(marketId);
          btn.textContent = watched ? "☆" : "★";
          btn.style.color = watched ? "#666" : "#f59e0b";
        }
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [onToggleWatch, isWatched]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div ref={mapContainer} className="w-full h-full" />
      <MapToolbar
        timeRange={timeRange}
        onTimeRangeChange={onTimeRangeChange}
        onToggleFullscreen={onToggleFullscreen}
        isFullscreen={isFullscreen}
        activeCategories={activeCategories}
        onToggleCategory={onToggleCategory}
        region={region ?? "global"}
        onRegionChange={onRegionChange}
        colorMode={colorMode}
        onColorModeChange={onColorModeChange}
        activeLayers={activeLayers}
        onToggleLayer={onToggleLayer}
      />
      {/* Hover preview popup — portal to body */}
      {hoverCountry && (() => {
        const all = markets;
        const ms = all.filter((m) => marketMatchesCountry(m.location, hoverCountry.name));
        const active = ms.filter((m) => !m.closed);
        const vol = ms.reduce((s, m) => s + m.volume, 0);
        const vol24h = ms.reduce((s, m) => s + (m.volume24h || 0), 0);
        const flag = getCountryFlag(hoverCountry.name);
        const POP_W = 200;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const left = Math.min(hoverCountry.x + 16, vw - POP_W - 8);
        const top = Math.min(hoverCountry.y + 16, vh - 160);
        return createPortal(
          <div
            className="fixed z-[9998] bg-[var(--bg)] border border-[var(--border)] rounded-md font-mono pointer-events-none"
            style={{ top, left, width: POP_W, padding: "10px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[16px] leading-none">{flag}</span>
              <span className="text-[11px] text-[var(--text)]">{hoverCountry.name}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
              <span className="text-[var(--text-faint)]">{t("common.markets")}</span>
              <span className="text-[var(--text-secondary)] tabular-nums">{ms.length}</span>
              <span className="text-[var(--text-faint)]">{t("common.active")}</span>
              <span className="text-[var(--text-secondary)] tabular-nums">{active.length}</span>
              <span className="text-[var(--text-faint)]">{t("common.volume")}</span>
              <span className="text-[var(--text-secondary)] tabular-nums">{formatVolume(vol)}</span>
              <span className="text-[var(--text-faint)]">{t("common.vol24h")}</span>
              <span className="text-[var(--text-secondary)] tabular-nums">{formatVolume(vol24h)}</span>
            </div>
            {active.length > 0 && (() => {
              const topMarket = active.reduce((best, m) => (m.volume24h || 0) > (best.volume24h || 0) ? m : best);
              return (
                <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
                  <div className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider mb-0.5">{t("common.topMarket")}</div>
                  <div className="text-[10px] text-[var(--text-dim)] line-clamp-2 leading-snug">
                    {localizeMarket(topMarket, locale).title}
                  </div>
                </div>
              );
            })()}
          </div>,
          document.body
        );
      })()}

      {/* Overlay layer loaded alert */}
      {layerAlert && (
        <div
          className="absolute bottom-14 left-2.5 z-20 font-mono flex items-center gap-2 px-3 py-2 text-[12px] pointer-events-none"
          style={{
            background: "rgba(8,8,8,0.92)",
            border: `1px solid ${layerAlert.color}40`,
            borderLeft: `3px solid ${layerAlert.color}`,
            backdropFilter: "blur(6px)",
            animation: "overlayAlertIn 0.25s ease-out",
          }}
        >
          <span className="text-[15px] leading-none">{layerAlert.emoji}</span>
          <span className="tabular-nums font-bold" style={{ color: layerAlert.color }}>{layerAlert.count}</span>
          <span className="text-[#aaa]">{layerAlert.label}</span>
          <span className="text-[#555]">loaded</span>
        </div>
      )}

      {hoverOverlay && createPortal(
        (() => {
          const TIP_W = 220;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const left = Math.min(hoverOverlay.x + 14, vw - TIP_W - 8);
          const top  = Math.min(hoverOverlay.y + 14, vh - 160);
          return (
            <div
              className="fixed z-[9998] font-mono pointer-events-none"
              style={{
                top, left, width: TIP_W,
                background: "#0c0c0c",
                border: `1px solid #2a2a2a`,
                borderLeft: `2px solid ${hoverOverlay.color}`,
                boxShadow: `0 4px 20px rgba(0,0,0,0.7), 0 0 0 0 transparent`,
                padding: "8px 10px",
              }}
            >
              {/* Layer badge */}
              <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: hoverOverlay.color }}>
                {hoverOverlay.layerId.replace(/-/g, " ")}
              </div>
              {/* Title */}
              <div className="text-[11px] text-[#ddd] leading-snug mb-1.5 line-clamp-3">
                {hoverOverlay.title}
              </div>
              {/* Key-value rows */}
              {hoverOverlay.rows.length > 0 && (
                <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 mt-1 pt-1.5 border-t border-[#222]">
                  {hoverOverlay.rows.map(({ label, value }) => (
                    <React.Fragment key={label}>
                      <span className="text-[10px] text-[#555] uppercase tracking-wider">{label}</span>
                      <span className="text-[10px] text-[#999] tabular-nums truncate">{value}</span>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          );
        })(),
        document.body
      )}

      {hoverMarket && hoverPos && createPortal(
        <div
          className="fixed z-[9999] bg-[var(--bg)] border border-[var(--border)] rounded-md overflow-y-auto"
          style={{
            ...(hoverPos.top !== undefined ? { top: hoverPos.top } : {}),
            ...(hoverPos.bottom !== undefined ? { bottom: hoverPos.bottom } : {}),
            left: hoverPos.left,
            width: PREVIEW_W,
            maxHeight: PREVIEW_MAX_H,
            padding: "12px 14px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
          }}
          onMouseEnter={() => {
            // Cancel pending dismiss when mouse enters popup
            if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
          }}
          onMouseLeave={() => {
            // Dismiss when mouse leaves popup
            setHoverMarket(null);
            setHoverPos(null);
          }}
        >
          <Suspense fallback={<div className="text-[12px] text-[var(--text-faint)] font-mono py-4">loading...</div>}>
            <MarketPreview market={hoverMarket} onTrade={onTrade} hideChart />
          </Suspense>
        </div>,
        document.body
      )}
    </div>
  );
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}


export default memo(WorldMapInner, (prev, next) => {
  if (prev.markets !== next.markets) return false;
  if (!setsEqual(prev.activeCategories, next.activeCategories)) return false;
  if (prev.flyToTarget !== next.flyToTarget) return false;
  if (prev.timeRange !== next.timeRange) return false;
  if (prev.isFullscreen !== next.isFullscreen) return false;
  if (prev.selectedCountry !== next.selectedCountry) return false;
  if (prev.selectedMarketId !== next.selectedMarketId) return false;
  if (prev.colorMode !== next.colorMode) return false;
  if (prev.region !== next.region) return false;
  if (prev.newMarkets !== next.newMarkets) return false;
  if (prev.whaleTrades !== next.whaleTrades) return false;
  if (prev.isWatched !== next.isWatched) return false;
  if (!setsEqual(prev.activeLayers, next.activeLayers)) return false;
  return true;
});
