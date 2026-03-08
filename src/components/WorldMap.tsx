"use client";

import { useEffect, useRef, useCallback, useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ProcessedMarket, Category, WhaleTrade } from "@/types";
import { CATEGORY_COLORS, CATEGORY_SHAPES } from "@/lib/categories";
import { IMPACT_COLORS } from "@/lib/impact";
import type { ImpactLevel } from "@/types";
import { formatVolume, formatPct, formatChange } from "@/lib/format";
import { REGIONAL_VIEWS } from "@/lib/regions";
import type { TimeRange } from "./TimeRangeFilter";
import MapToolbar from "./MapToolbar";

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
  watchedIds?: Set<string>;
  whaleTrades?: WhaleTrade[];
}

// ─── 3-Tier Geographic Hierarchy ─────────────────────────────────
// Tier 0 (zoom < 2.5): Continental — one bubble per continent/macro-region
// Tier 1 (zoom 2.5–4): Country groups — large countries separate, small countries merge by sub-region
// Tier 2 (zoom 4–6): Country-level — each country is its own bubble
// Tier 3 (zoom > 6): Individual bubbles (offsetColocated only)

const ZOOM_TIER_THRESHOLDS = [2];

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
  Taiwan: "East Asia", "Hong Kong": "East Asia", Mongolia: "East Asia",
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

export default function WorldMap({
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
  watchedIds,
  whaleTrades,
}: WorldMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [currentTier, setCurrentTier] = useState(0);
  const marketsLookup = useRef<Map<string, ProcessedMarket>>(new Map());
  const countryLayersAdded = useRef(false);
  const pulseRef = useRef<number>(0);
  const pinMarkerRef = useRef<maplibregl.Marker | null>(null);
  const newMarketAnimRef = useRef<Map<string, { startTime: number; lng: number; lat: number }>>(new Map());
  const starMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const tradeFlashesRef = useRef<{ key: string; lng: number; lat: number; startTime: number; side: "BUY" | "SELL"; isSmart: boolean }[]>([]);
  const seenTradeKeysRef = useRef<Set<string>>(new Set());
  const prevMarketIdsRef = useRef<Map<string, { lng: number; lat: number; color: string }>>(new Map());
  const prevTierRef = useRef<number>(0);
  const closedAnimsRef = useRef<Map<string, { startTime: number; lng: number; lat: number; color: string }>>(new Map());
  const reducedMotionCleanup = useRef<(() => void) | null>(null);

  // Hover preview popup state
  const [hoverMarket, setHoverMarket] = useState<ProcessedMarket | null>(null);
  const [hoverPos, setHoverPos] = useState<{ top: number; left: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PREVIEW_W = 480;
  const PREVIEW_MAX_H = 520;

  const clearHoverPopup = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHoverMarket(null);
    setHoverPos(null);
  }, []);

  // Initialize map with CARTO vector tiles
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: DARK_STYLE,
      center: [10, 25],
      zoom: 1.8,
      minZoom: 1.2,
      maxZoom: 10,
      attributionControl: false,
      renderWorldCopies: false,
      maxPitch: 0,
      pitchWithRotate: false,
      dragRotate: false,
    });

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
      const animatePulse = () => {
        if (prefersReducedMotion) {
          pulseRef.current = requestAnimationFrame(animatePulse);
          return;
        }
        phase = (phase + 0.04) % (2 * Math.PI);
        const sin = Math.sin(phase);
        if (map.getLayer("signal-glow")) {
          map.setPaintProperty("signal-glow", "circle-opacity", clamp01(0.15 + 0.1 * sin));
        }
        // Outer pulse ring
        if (map.getLayer("signal-pulse-ring")) {
          map.setPaintProperty("signal-pulse-ring", "circle-stroke-opacity", clamp01(0.08 + 0.06 * Math.sin(phase * 0.7)));
        }
        // Selected market ring pulse + faint glow fill
        if (map.getLayer("selected-ring")) {
          map.setPaintProperty("selected-ring", "circle-stroke-opacity", clamp01(0.5 + 0.3 * sin));
          map.setPaintProperty("selected-ring", "circle-opacity", clamp01(0.08 + 0.04 * sin));
        }
        // Selected beacon — half-speed breathing
        if (map.getLayer("selected-beacon")) {
          map.setPaintProperty("selected-beacon", "circle-stroke-opacity", clamp01(0.10 + 0.08 * Math.sin(phase * 0.5)));
        }
        // Anomaly amber glow pulse
        if (map.getLayer("anomaly-glow")) {
          map.setPaintProperty("anomaly-glow", "circle-opacity", clamp01(0.08 + 0.06 * Math.sin(phase * 1.2)));
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
    });

    return () => {
      cancelAnimationFrame(pulseRef.current);
      reducedMotionCleanup.current?.();
      if (pinMarkerRef.current) pinMarkerRef.current.remove();
      for (const m of starMarkersRef.current.values()) m.remove();
      starMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
      countryLayersAdded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Generate SDF shape icons for category-shaped markers
  function generateShapeIcons(map: maplibregl.Map) {
    const size = 32;
    const cx = size / 2;
    const cy = size / 2;

    const shapes: Record<string, (ctx: CanvasRenderingContext2D) => void> = {
      circle: (ctx) => {
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      },
      star: (ctx) => {
        const outerR = 14, innerR = 6, points = 5;
        for (let i = 0; i < points * 2; i++) {
          const r = i % 2 === 0 ? outerR : innerR;
          const angle = (Math.PI / 2) * -1 + (Math.PI / points) * i;
          const method = i === 0 ? "moveTo" : "lineTo";
          ctx[method](cx + r * Math.cos(angle), cy + r * Math.sin(angle));
        }
        ctx.closePath();
      },
      diamond: (ctx) => {
        ctx.moveTo(cx, cy - 14);
        ctx.lineTo(cx + 11, cy);
        ctx.lineTo(cx, cy + 14);
        ctx.lineTo(cx - 11, cy);
        ctx.closePath();
      },
      triangle: (ctx) => {
        const r = 14;
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * Math.cos(Math.PI / 6), cy + r * Math.sin(Math.PI / 6));
        ctx.lineTo(cx - r * Math.cos(Math.PI / 6), cy + r * Math.sin(Math.PI / 6));
        ctx.closePath();
      },
      hexagon: (ctx) => {
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          const method = i === 0 ? "moveTo" : "lineTo";
          ctx[method](cx + 14 * Math.cos(angle), cy + 14 * Math.sin(angle));
        }
        ctx.closePath();
      },
      pentagon: (ctx) => {
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
          const method = i === 0 ? "moveTo" : "lineTo";
          ctx[method](cx + 14 * Math.cos(angle), cy + 14 * Math.sin(angle));
        }
        ctx.closePath();
      },
      square: (ctx) => {
        const r = 2, s = 12;
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

    for (const [name, draw] of Object.entries(shapes)) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.beginPath();
      draw(ctx);
      ctx.fillStyle = "white";
      ctx.fill();
      const imageData = ctx.getImageData(0, 0, size, size);
      map.addImage(`shape-${name}`, imageData, { sdf: true });
    }
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

    // Shape stroke — dark outline (same shape, slightly larger)
    add({
      id: "unclustered-stroke",
      type: "symbol",
      source: "markets",
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["concat", "shape-", ["get", "shape"]],
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          1.5, ["+", ["*", ["get", "radius"], 0.05],  0.012],
          4,   ["+", ["*", ["get", "radius"], 0.065], 0.012],
          8,   ["+", ["*", ["get", "radius"], 0.08],  0.012],
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-color": "#000000",
        "icon-opacity": 0.7,
      },
    });

    // Core shape — category-shaped SDF icons
    add({
      id: "unclustered-point",
      type: "symbol",
      source: "markets",
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["concat", "shape-", ["get", "shape"]],
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          1.5, ["*", ["get", "radius"], 0.05],
          4,   ["*", ["get", "radius"], 0.065],
          8,   ["*", ["get", "radius"], 0.08],
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-color": ["get", "color"],
        "icon-opacity": 0.85,
      },
    });

    // Signal glow (pulsing via rAF) — proportional radius
    add({
      id: "signal-glow",
      type: "circle",
      source: "markets",
      filter: ["all", ["!", ["has", "point_count"]], ["get", "hasSignal"]],
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

    // Click individual → popup + callback
    map.on("click", "unclustered-point", (e) => {
      if (!e.features?.length) return;
      const props = e.features[0].properties;
      const geom = e.features[0].geometry;
      if (!props || geom.type !== "Point") return;
      const market = marketsLookup.current.get(props.marketId);
      if (!market) return;
      // Clear hover preview
      clearHoverPopup();
      if (popupRef.current) popupRef.current.remove();
      popupRef.current = new maplibregl.Popup({ offset: 15, maxWidth: "320px" })
        .setLngLat(geom.coordinates as [number, number])
        .setHTML(buildPopupHtml(market))
        .addTo(map);
      // Notify parent about market selection
      if (onMarketClick) onMarketClick(market);
    });

    // Hover: feature-state highlight + cursor + preview popup
    let hoveredId: string | number | null = null;
    map.on("mouseenter", "unclustered-point", (e) => {
      map.getCanvas().style.cursor = "pointer";
      if (e.features?.length) {
        const id = e.features[0].id;
        if (id !== undefined && id !== null) {
          hoveredId = id;
          map.setFeatureState({ source: "markets", id: hoveredId }, { hover: true });
        }
        const props = e.features[0].properties;
        if (props?.marketId) {
          const market = marketsLookup.current.get(props.marketId);
          if (market) {
            // Clear any pending timer
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
            hoverTimer.current = setTimeout(() => {
              const point = e.point;
              const canvas = map.getCanvas().getBoundingClientRect();
              const screenX = canvas.left + point.x;
              const screenY = canvas.top + point.y;
              const vw = window.innerWidth;
              const vh = window.innerHeight;
              // Position: prefer right of cursor; if no space, go left
              let left = screenX + 16;
              if (left + PREVIEW_W > vw - 4) {
                left = screenX - PREVIEW_W - 16;
              }
              left = Math.max(4, Math.min(left, vw - PREVIEW_W - 4));
              let top = screenY - 40;
              top = Math.max(4, Math.min(top, vh - PREVIEW_MAX_H - 4));
              setHoverMarket(market);
              setHoverPos({ top, left });
            }, 600);
          }
        }
      }
    });
    map.on("mouseleave", "unclustered-point", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredId !== null) {
        map.setFeatureState({ source: "markets", id: hoveredId }, { hover: false });
        hoveredId = null;
      }
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
      setHoverMarket(null);
      setHoverPos(null);
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
        // Remove Taiwan as separate entity to avoid territorial disputes
        countries.features = countries.features.filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (f: any) => f.properties?.name !== "Taiwan"
        );
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

        // Mouse interaction
        let hoveredName: string | null = null;

        map.on("mousemove", "country-fills", (e) => {
          const feat = e.features?.[0];
          const name = feat?.properties?.name as string | undefined;
          if (name && name !== hoveredName) {
            hoveredName = name;
            map.setFilter("country-hover", ["==", ["get", "name"], name]);
            map.setFilter("country-hover-border", ["==", ["get", "name"], name]);
          }
        });

        map.on("mouseleave", "country-fills", () => {
          hoveredName = null;
          map.setFilter("country-hover", ["==", ["get", "name"], ""]);
          map.setFilter("country-hover-border", ["==", ["get", "name"], ""]);
        });

        // Country click → callback
        map.on("click", "country-fills", (e) => {
          const feat = e.features?.[0];
          const name = feat?.properties?.name as string | undefined;
          if (name && onCountryClick) {
            onCountryClick(name);
          }
        });
      })
      .catch((err) => console.warn("Failed to load country boundaries:", err));
  }

  // Build popup HTML
  const buildPopupHtml = useCallback((market: ProcessedMarket) => {
    const color = CATEGORY_COLORS[market.category] || CATEGORY_COLORS.Other;
    const mks = market.markets.slice(0, 3);
    let marketsHtml = "";

    if (mks.length > 0) {
      for (const m of mks) {
        let mp = null;
        try {
          mp = m.outcomePrices
            ? Array.isArray(m.outcomePrices)
              ? m.outcomePrices
              : JSON.parse(m.outcomePrices)
            : null;
        } catch { /* skip malformed */ }
        const mProb = mp ? parseFloat(mp[0]) : market.prob;
        const mChg = formatChange(
          m.oneDayPriceChange !== undefined
            ? parseFloat(String(m.oneDayPriceChange))
            : market.change
        );
        const question = m.question || market.title;
        marketsHtml += `
          <div style="padding:4px 0;border-top:1px solid #2a2a2a;">
            <div style="font-size:12px;color:#a0a0a0;margin-bottom:2px;">${escapeHtml(question)}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px;">
              <span style="color:#d4d4d4">${mProb !== null ? formatPct(mProb) : "—"}</span>
              <span style="${
                mChg.cls === "up"
                  ? "color:#22c55e"
                  : mChg.cls === "down"
                  ? "color:#ff4444"
                  : "color:#777"
              }">${mChg.text}</span>
            </div>
          </div>`;
      }
    } else {
      const chg = formatChange(market.change);
      marketsHtml = `
        <div style="padding:4px 0;">
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px;">
            <span style="color:#d4d4d4">${market.prob !== null ? formatPct(market.prob) : "—"}</span>
            <span style="color:${chg.cls === "up" ? "#22c55e" : chg.cls === "down" ? "#ff4444" : "#777"}">${chg.text}</span>
          </div>
        </div>`;
    }

    const watched = isWatched?.(market.id);
    const starFill = watched ? "#f59e0b" : "none";
    const starStroke = watched ? "#f59e0b" : "#666";
    const starLabel = watched ? "★" : "☆";

    return `
      <div style="font-family:'JetBrains Mono','SF Mono',monospace;min-width:200px;max-width:280px;font-size:13px;">
        <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:3px;">
          <div style="font-size:13px;color:#f0f0f0;line-height:1.4;flex:1;">${escapeHtml(market.title)}</div>
          <button data-watch-market="${market.id}" style="background:none;border:none;cursor:pointer;padding:2px;font-size:14px;color:${starStroke};flex-shrink:0;" title="${watched ? "Remove from watchlist" : "Add to watchlist"}">${starLabel}</button>
        </div>
        <div style="font-size:11px;color:#8a8a8a;margin-bottom:2px;text-transform:lowercase;">${escapeHtml(market.location || market.category)}</div>
        ${marketsHtml}
        <div style="font-size:11px;color:#777;margin-top:3px;">vol ${formatVolume(market.volume)} · 24h ${formatVolume(market.volume24h)}</div>
        <a href="https://polymarket.com/event/${encodeURIComponent(market.slug)}?via=pw" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;font-size:11px;color:#a0a0a0;text-decoration:none;">polymarket →</a>
      </div>`;
  }, [isWatched]);

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
      prevMarketIdsRef.current = currentIds;
    } else if (tierChanged) {
      // Reset tracking on tier change
      prevMarketIdsRef.current = new Map();
    }
  }, [markets, activeCategories, mapReady, colorMode, selectedMarketId, currentTier]);

  // Update selected country highlight
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const filter = selectedCountry
      ? ["==", ["get", "name"], selectedCountry]
      : ["==", ["get", "name"], ""];
    if (map.getLayer("country-selected")) {
      map.setFilter("country-selected", filter as maplibregl.FilterSpecification);
    }
    if (map.getLayer("country-selected-border")) {
      map.setFilter("country-selected-border", filter as maplibregl.FilterSpecification);
    }
  }, [selectedCountry, mapReady]);

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

    // Use offset-colocated coords (actual bubble position) when available
    const looked = marketsLookup.current.get(flyToTarget.marketId);
    const bubbleCoords: [number, number] = looked?.coords
      ? [looked.coords[1], looked.coords[0]]
      : [flyToTarget.coords[1], flyToTarget.coords[0]];
    // Raw coords for initial flyTo (close enough to find the cluster)
    const rawCenter: [number, number] = [flyToTarget.coords[1], flyToTarget.coords[0]];
    const targetZoom = Math.max(map.getZoom(), 5);

    map.flyTo({ center: rawCenter, zoom: targetZoom, duration: 1500 });

    // After flyTo completes, ensure the bubble is visible and centered
    map.once("moveend", () => {
      const point = map.project(rawCenter);
      const unclustered = map.queryRenderedFeatures(point, { layers: ["unclustered-point"] });
      const visible = unclustered.some((f) => f.properties?.marketId === flyToTarget.marketId);
      if (visible) {
        // Bubble visible but may be off-center due to offset — recenter
        if (bubbleCoords[0] !== rawCenter[0] || bubbleCoords[1] !== rawCenter[1]) {
          map.easeTo({ center: bubbleCoords, duration: 400 });
        }
        return;
      }

      // Market still in continent cluster — zoom past threshold
      map.easeTo({ center: bubbleCoords, zoom: Math.max(ZOOM_TIER_THRESHOLDS[0] + 0.5, 5), duration: 800 });
    });
  }, [flyToTarget]);

  // Selected market pin marker
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    // Remove existing pin
    if (pinMarkerRef.current) {
      pinMarkerRef.current.remove();
      pinMarkerRef.current = null;
    }

    if (!selectedMarketId) return;

    const market = markets.find((m) => m.id === selectedMarketId);
    if (!market?.coords) return;

    const el = document.createElement("div");
    el.className = "selected-pin-marker";
    el.textContent = "📍";

    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([market.coords[1], market.coords[0]])
      .addTo(mapRef.current);

    pinMarkerRef.current = marker;
  }, [selectedMarketId, markets, mapReady]);

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
  }, [newMarkets]);

  // Feature 3: Sync watchlist star markers
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const currentStars = starMarkersRef.current;
    const activeIds = new Set<string>();

    if (watchedIds) {
      for (const id of watchedIds) {
        // Use offset-adjusted coords from marketsLookup (populated by GeoJSON update effect)
        const market = marketsLookup.current.get(id) || markets.find((m) => m.id === id);
        if (!market?.coords) continue;
        activeIds.add(id);
        const lngLat: [number, number] = [market.coords[1], market.coords[0]];
        if (currentStars.has(id)) {
          // Update position (may change due to offsetColocated recalculation)
          currentStars.get(id)!.setLngLat(lngLat);
        } else {
          const el = document.createElement("div");
          el.className = "watchlist-star-marker";
          el.textContent = "\u2B50";
          const marker = new maplibregl.Marker({ element: el, offset: [0, -14] })
            .setLngLat(lngLat)
            .addTo(map);
          currentStars.set(id, marker);
        }
      }
    }

    // Remove markers for unwatched markets
    for (const [id, marker] of currentStars) {
      if (!activeIds.has(id)) {
        marker.remove();
        currentStars.delete(id);
      }
    }
  }, [watchedIds, markets, mapReady, currentTier]);

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
    // Prune dedup set to prevent unbounded memory growth
    if (seenTradeKeysRef.current.size > 500) {
      const keep = new Set<string>();
      for (const trade of whaleTrades) {
        keep.add(`${trade.wallet}:${trade.conditionId}:${trade.timestamp}`);
      }
      seenTradeKeysRef.current = keep;
    }
  }, [whaleTrades, markets]);

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
      />
      {/* Hover preview popup — portal to body */}
      {hoverMarket && hoverPos && createPortal(
        <div
          className="fixed z-[9999] bg-[var(--bg)] border border-[var(--border)] rounded-md overflow-y-auto pointer-events-none"
          style={{
            top: hoverPos.top,
            left: hoverPos.left,
            width: PREVIEW_W,
            maxHeight: PREVIEW_MAX_H,
            padding: "12px 14px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
          }}
        >
          <Suspense fallback={<div className="text-[12px] text-[var(--text-faint)] font-mono py-4">loading...</div>}>
            <MarketPreview market={hoverMarket} />
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

// Minimal TopoJSON → GeoJSON converter (for world-atlas topology)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function topojsonFeature(topology: any, object: any) {
  const arcs = topology.arcs;
  const transform = topology.transform;

  function decodeArc(arcIndex: number): [number, number][] {
    const arc = arcs[arcIndex < 0 ? ~arcIndex : arcIndex];
    const coords: [number, number][] = [];
    let x = 0,
      y = 0;
    for (const point of arc) {
      x += point[0];
      y += point[1];
      coords.push([
        transform ? x * transform.scale[0] + transform.translate[0] : x,
        transform ? y * transform.scale[1] + transform.translate[1] : y,
      ]);
    }
    if (arcIndex < 0) coords.reverse();
    return coords;
  }

  function decodeRing(indices: number[]): [number, number][] {
    const ring: [number, number][] = [];
    for (const idx of indices) {
      const arc = decodeArc(idx);
      for (let i = ring.length > 0 ? 1 : 0; i < arc.length; i++) {
        ring.push(arc[i]);
      }
    }
    return ring;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function geometry(obj: any): any {
    if (obj.type === "GeometryCollection") {
      return { type: "GeometryCollection", geometries: obj.geometries.map(geometry) };
    }
    if (obj.type === "Polygon") {
      return { type: "Polygon", coordinates: obj.arcs.map(decodeRing) };
    }
    if (obj.type === "MultiPolygon") {
      return {
        type: "MultiPolygon",
        coordinates: obj.arcs.map((polygon: number[][]) => polygon.map(decodeRing)),
      };
    }
    return obj;
  }

  const features = object.geometries.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (geom: any) => ({
      type: "Feature",
      properties: geom.properties || { name: geom.id },
      geometry: geometry(geom),
    })
  );

  // Post-process: split cross-antimeridian polygons
  return {
    type: "FeatureCollection" as const,
    features: features.flatMap(fixAntimeridianFeature),
  };
}

// Split features whose polygon rings cross the antimeridian (±180° longitude).
// Without this, countries like Russia render horizontal lines spanning the map.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixAntimeridianFeature(feature: any): any[] {
  const geom = feature.geometry;
  if (geom.type === "Polygon") {
    const split = splitPolygonRings(geom.coordinates);
    if (split.length === 1) return [feature];
    return split.map((coords) => ({
      ...feature,
      geometry: { type: "Polygon", coordinates: coords },
    }));
  }
  if (geom.type === "MultiPolygon") {
    const allPolygons: [number, number][][][] = [];
    for (const poly of geom.coordinates) {
      const split = splitPolygonRings(poly);
      allPolygons.push(...split);
    }
    return [
      {
        ...feature,
        geometry: { type: "MultiPolygon", coordinates: allPolygons },
      },
    ];
  }
  return [feature];
}

// Check if a ring actually spans the antimeridian (has points in both >160 and <-160).
// This prevents false positives for countries like Australia that are near but don't cross.
function ringsSpanAntimeridian(rings: [number, number][][]): boolean {
  const outer = rings[0];
  if (!outer) return false;
  let hasEast = false, hasWest = false;
  for (const [lng] of outer) {
    if (lng > 160) hasEast = true;
    if (lng < -160) hasWest = true;
    if (hasEast && hasWest) return true;
  }
  return false;
}

// Split polygon rings that cross the antimeridian into separate east/west polygons.
// Uses segment-walking to preserve vertex ordering (unlike simple bucketing).
function splitPolygonRings(
  rings: [number, number][][]
): [number, number][][][] {
  const outer = rings[0];
  if (!outer || outer.length < 4) return [rings];
  if (!ringsSpanAntimeridian(rings)) return [rings];

  // Detect actual crossing edges
  let crosses = false;
  for (let i = 1; i < outer.length; i++) {
    if (Math.abs(outer[i][0] - outer[i - 1][0]) > 180) {
      crosses = true;
      break;
    }
  }
  if (!crosses) return [rings];

  // Walk the ring sequentially, building ordered segments per side
  const eastSegments: [number, number][][] = [];
  const westSegments: [number, number][][] = [];

  let currentSide: "east" | "west" = outer[0][0] >= 0 ? "east" : "west";
  let currentSegment: [number, number][] = [outer[0]];

  for (let i = 1; i < outer.length; i++) {
    const prev = outer[i - 1];
    const curr = outer[i];

    if (Math.abs(curr[0] - prev[0]) > 180) {
      // Crossing detected — interpolate the latitude at ±180°
      const sign = prev[0] > 0 ? 1 : -1;
      const currAdj = curr[0] + sign * 360;
      const denominator = currAdj - prev[0];
      // When both points are at/near ±180° (e.g. Antarctica closing edge),
      // denominator ≈ 0 → use average latitude to avoid NaN
      const crossLat = Math.abs(denominator) < 0.01
        ? (prev[1] + curr[1]) / 2
        : prev[1] + ((sign * 180 - prev[0]) / denominator) * (curr[1] - prev[1]);

      // Close current segment at the boundary
      currentSegment.push([sign * 180, crossLat]);
      if (currentSide === "east") eastSegments.push(currentSegment);
      else westSegments.push(currentSegment);

      // Start new segment on the other side
      currentSide = currentSide === "east" ? "west" : "east";
      currentSegment = [[-sign * 180, crossLat], curr];
    } else {
      currentSegment.push(curr);
    }
  }

  // Close the final segment
  if (currentSegment.length > 0) {
    if (currentSide === "east") eastSegments.push(currentSegment);
    else westSegments.push(currentSegment);
  }

  // Merge segments per side into closed rings
  const result: [number, number][][][] = [];
  for (const segments of [eastSegments, westSegments]) {
    if (segments.length === 0) continue;
    const ring = segments.flat();
    if (ring.length >= 3) {
      const first = ring[0], last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(ring[0]);
      result.push([ring]);
    }
  }

  return result.length > 0 ? result : [rings];
}
