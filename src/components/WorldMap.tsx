"use client";

import { useEffect, useRef, useCallback, useState, lazy, Suspense, memo } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ProcessedMarket, Category, WhaleTrade } from "@/types";
import { CATEGORY_COLORS, CATEGORY_SHAPES } from "@/lib/categories";
import { IMPACT_COLORS } from "@/lib/impact";
import type { ImpactLevel } from "@/types";
import { formatVolume, formatPct, formatChange } from "@/lib/format";
import { REGIONAL_VIEWS } from "@/lib/regions";
import { topojsonFeature } from "@/lib/topojson";
import { getCountryFlag, marketMatchesCountry } from "@/lib/countries";
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
  whaleTrades?: WhaleTrade[];
}

// ─── 3-Tier Geographic Hierarchy ─────────────────────────────────
// Tier 0 (zoom < 2.5): Continental — one bubble per continent/macro-region
// Tier 1 (zoom 2.5–4): Country groups — large countries separate, small countries merge by sub-region
// Tier 2 (zoom 4–6): Country-level — each country is its own bubble
// Tier 3 (zoom > 6): Individual bubbles (offsetColocated only)

const ZOOM_TIER_THRESHOLDS = [1.5];

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

function setsEqual<T>(a?: Set<T>, b?: Set<T>): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
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
}: WorldMapProps) {
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

  // Hover preview popup state
  const [hoverMarket, setHoverMarket] = useState<ProcessedMarket | null>(null);
  const [hoverPos, setHoverPos] = useState<{ top: number; left: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Country hover popup state
  const [hoverCountry, setHoverCountry] = useState<{ name: string; x: number; y: number } | null>(null);
  const countryHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      zoom: 1.2,
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

    // Core shape — pre-colored icons with baked-in outlines (non-SDF)
    add({
      id: "unclustered-point",
      type: "symbol",
      source: "markets",
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": [
          "concat", "icon-",
          ["slice", ["get", "color"], 1],  // strip '#' from hex
          "-", ["get", "shape"],
        ],
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          1.5, ["*", ["get", "radius"], 0.05],
          4,   ["*", ["get", "radius"], 0.065],
          8,   ["*", ["get", "radius"], 0.08],
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

    // Click individual → callback only (no popup)
    map.on("click", "unclustered-point", (e) => {
      if (!e.features?.length) return;
      const props = e.features[0].properties;
      const geom = e.features[0].geometry;
      if (!props || geom.type !== "Point") return;
      const market = marketsLookup.current.get(props.marketId);
      if (!market) return;
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
            // Clear any pending timers (market + country)
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
            if (countryHoverTimer.current) clearTimeout(countryHoverTimer.current);
            setHoverCountry(null);
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
          // Clear any lingering market hover popup
          clearHoverPopup();
          if (name && name !== hoveredName) {
            hoveredName = name;
            map.setFilter("country-hover", ["==", ["get", "name"], name]);
            map.setFilter("country-hover-border", ["==", ["get", "name"], name]);
            if (countryHoverTimer.current) clearTimeout(countryHoverTimer.current);
            const { x, y } = e.point;
            countryHoverTimer.current = setTimeout(() => {
              setHoverCountry({ name, x, y });
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

        // Country click → callback
        map.on("click", "country-fills", (e) => {
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
              <span className="text-[var(--text-faint)]">markets</span>
              <span className="text-[var(--text-secondary)] tabular-nums">{ms.length}</span>
              <span className="text-[var(--text-faint)]">active</span>
              <span className="text-[var(--text-secondary)] tabular-nums">{active.length}</span>
              <span className="text-[var(--text-faint)]">volume</span>
              <span className="text-[var(--text-secondary)] tabular-nums">{formatVolume(vol)}</span>
              <span className="text-[var(--text-faint)]">24h vol</span>
              <span className="text-[var(--text-secondary)] tabular-nums">{formatVolume(vol24h)}</span>
            </div>
            {active.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
                <div className="text-[9px] text-[var(--text-faint)] uppercase tracking-wider mb-0.5">top market</div>
                <div className="text-[10px] text-[var(--text-dim)] line-clamp-2 leading-snug">
                  {active.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))[0].title}
                </div>
              </div>
            )}
          </div>,
          document.body
        );
      })()}

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
  return true;
});
