"use client";

import { useEffect, useRef, useCallback, useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ProcessedMarket, Category } from "@/types";
import { CATEGORY_COLORS } from "@/lib/categories";
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
    // Compact spacing: smaller bubbles (max 10px radius = 20px diameter) need less spread.
    // At zoom ~2, 1° ≈ 70px. 20px diameter → need ~0.3° between centers.
    const spacing = group.length > 15 ? 0.35 : group.length > 5 ? 0.25 : 0.18;
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
}: WorldMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const marketsLookup = useRef<Map<string, ProcessedMarket>>(new Map());
  const countryLayersAdded = useRef(false);
  const pulseRef = useRef<number>(0);

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

    map.on("style.load", () => {
      // Find the first symbol (label) layer so we can insert market layers below it
      const labelLayerId = map.getStyle().layers?.find(
        (l) => l.type === "symbol" && (l as { layout?: { "text-field"?: unknown } }).layout?.["text-field"]
      )?.id;
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

      // Animated signal pulse + selected ring + anomaly glow
      let phase = 0;
      const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
      const animatePulse = () => {
        phase = (phase + 0.04) % (2 * Math.PI);
        const sin = Math.sin(phase);
        if (map.getLayer("signal-glow")) {
          map.setPaintProperty("signal-glow", "circle-opacity", clamp01(0.15 + 0.1 * sin));
        }
        // Outer pulse ring
        if (map.getLayer("signal-pulse-ring")) {
          map.setPaintProperty("signal-pulse-ring", "circle-stroke-opacity", clamp01(0.08 + 0.06 * Math.sin(phase * 0.7)));
        }
        // Selected market ring pulse
        if (map.getLayer("selected-ring")) {
          map.setPaintProperty("selected-ring", "circle-stroke-opacity", clamp01(0.5 + 0.3 * sin));
        }
        // Anomaly amber glow pulse
        if (map.getLayer("anomaly-glow")) {
          map.setPaintProperty("anomaly-glow", "circle-opacity", clamp01(0.08 + 0.06 * Math.sin(phase * 1.2)));
        }
        pulseRef.current = requestAnimationFrame(animatePulse);
      };
      pulseRef.current = requestAnimationFrame(animatePulse);
    });

    return () => {
      cancelAnimationFrame(pulseRef.current);
      map.remove();
      mapRef.current = null;
      countryLayersAdded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Add GeoJSON clustered source + layers for markets
  // beforeId: insert all market layers below this layer (typically the first label layer)
  function addMarketLayers(map: maplibregl.Map, beforeId?: string) {
    map.addSource("markets", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterMaxZoom: 9,
      clusterRadius: 40,
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

    // Outer glow — volume-scaled intensity, proportional radius
    add({
      id: "marker-glow",
      type: "circle",
      source: "markets",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          1.5, ["+", ["*", ["get", "radius"], 1.5], 2],
          6, ["+", ["*", ["get", "radius"], 1.6], 3],
        ],
        "circle-opacity": [
          "interpolate", ["linear"], ["zoom"],
          1.5, ["*", ["get", "glowIntensity"], 0.5],
          4, ["get", "glowIntensity"],
          8, ["*", ["get", "glowIntensity"], 1.1],
        ],
        "circle-blur": 0.8,
      },
    });

    // Core dot — fully opaque so it stands out against dark bg
    add({
      id: "unclustered-point",
      type: "circle",
      source: "markets",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          1.5, ["*", ["get", "radius"], 0.8],
          4, ["get", "radius"],
          8, ["*", ["get", "radius"], 1.2],
        ],
        "circle-opacity": 1,
        "circle-stroke-width": 0,
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

    // Selected market ring — persistent green pulse
    add({
      id: "selected-ring",
      type: "circle",
      source: "markets",
      filter: ["all", ["!", ["has", "point_count"]], ["get", "isSelected"]],
      paint: {
        "circle-color": "transparent",
        "circle-radius": ["+", ["get", "radius"], 4],
        "circle-stroke-width": 1.2,
        "circle-stroke-color": "#22c55e",
        "circle-stroke-opacity": 0.7,
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

    // --- INTERACTIONS ---

    // Click cluster → zoom in
    map.on("click", "clusters", (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
      if (!features.length) return;
      const clusterId = features[0].properties?.cluster_id;
      const source = map.getSource("markets") as maplibregl.GeoJSONSource;
      source.getClusterExpansionZoom(clusterId).then((zoom) => {
        const geom = features[0].geometry;
        if (geom.type === "Point") {
          map.easeTo({ center: geom.coordinates as [number, number], zoom: Math.min(zoom + 1, 10) });
        }
      });
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
              const screenY = canvas.left + point.y;
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

    return `
      <div style="font-family:'JetBrains Mono','SF Mono',monospace;min-width:200px;max-width:280px;font-size:13px;">
        <div style="font-size:13px;color:#f0f0f0;margin-bottom:3px;line-height:1.4;">${escapeHtml(market.title)}</div>
        <div style="font-size:11px;color:#8a8a8a;margin-bottom:2px;text-transform:lowercase;">${escapeHtml(market.location || market.category)}</div>
        ${marketsHtml}
        <div style="font-size:11px;color:#777;margin-top:3px;">vol ${formatVolume(market.volume)} · 24h ${formatVolume(market.volume24h)}</div>
        <a href="https://polymarket.com/event/${encodeURIComponent(market.slug)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;font-size:11px;color:#a0a0a0;text-decoration:none;">polymarket →</a>
      </div>`;
  }, []);

  // Update GeoJSON source when data/filters change
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const source = map.getSource("markets") as maplibregl.GeoJSONSource;
    if (!source) return;

    const filtered = markets.filter((m) => activeCategories.has(m.category));
    const spaced = offsetColocated(filtered);

    marketsLookup.current.clear();
    for (const m of spaced) {
      marketsLookup.current.set(m.id, m);
    }

    // Compute log+sqrt area-proportional sizing (2–10px)
    const volumes = spaced.filter((m) => m.coords).map((m) => m.volume24h || m.volume || 0);
    volumes.sort((a, b) => a - b);

    const minR = 2, maxR = 10;
    const logMin = Math.log1p(volumes[0] || 0);
    const logMax = Math.log1p(volumes[volumes.length - 1] || 1);

    const features = spaced
      .filter((m) => m.coords)
      .map((m, i) => {
        const color = colorMode === "impact"
          ? IMPACT_COLORS[m.impactLevel as ImpactLevel] || IMPACT_COLORS.info
          : CATEGORY_COLORS[m.category] || CATEGORY_COLORS.Other;
        const vol = m.volume24h || m.volume || 0;

        // Log + sqrt scale: perceptually linear area sizing
        const logVol = Math.log1p(vol);
        const t = logMax > logMin ? (logVol - logMin) / (logMax - logMin) : 0;
        const radius = minR + Math.sqrt(t) * (maxR - minR);

        // Volume-scaled glow intensity
        const glowIntensity = 0.12 + t * 0.3; // 0.12–0.42

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
          },
        };
      });

    source.setData({ type: "FeatureCollection", features });
  }, [markets, activeCategories, mapReady, colorMode, selectedMarketId]);

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

  // Fly to target
  useEffect(() => {
    if (!flyToTarget || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [flyToTarget.coords[1], flyToTarget.coords[0]],
      zoom: 5,
      duration: 1500,
    });
  }, [flyToTarget]);

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
