"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ProcessedMarket, Category } from "@/types";
import { CATEGORY_COLORS } from "@/lib/categories";
import { formatVolume, formatPct, formatChange } from "@/lib/format";
import type { TimeRange } from "./TimeRangeFilter";
import MapToolbar from "./MapToolbar";

// CARTO GL vector tile style — gives us zoom-dependent labels:
// zoomed out = continent names only, zoomed in = country names + borders
const DARK_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

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
}

// Offset co-located markers using golden-angle spiral for organic non-overlapping layout
function offsetColocated(markets: ProcessedMarket[]): ProcessedMarket[] {
  const groups = new Map<string, ProcessedMarket[]>();
  for (const m of markets) {
    if (!m.coords) continue;
    const key = `${Math.round(m.coords[0])},${Math.round(m.coords[1])}`;
    const arr = groups.get(key) || [];
    arr.push(m);
    groups.set(key, arr);
  }

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const spacing = 0.35;

  const result: ProcessedMarket[] = [];
  for (const m of markets) {
    if (!m.coords) {
      result.push(m);
      continue;
    }
    const key = `${Math.round(m.coords[0])},${Math.round(m.coords[1])}`;
    const group = groups.get(key)!;
    if (group.length <= 1) {
      result.push(m);
      continue;
    }
    const idx = group.indexOf(m);
    const angle = idx * goldenAngle;
    const r = spacing * Math.sqrt(idx);
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
}: WorldMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const marketsLookup = useRef<Map<string, ProcessedMarket>>(new Map());
  const countryLayersAdded = useRef(false);
  const pulseRef = useRef<number>(0);

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

      // Animated signal pulse
      let phase = 0;
      const animatePulse = () => {
        phase = (phase + 0.04) % (2 * Math.PI);
        const opacity = 0.15 + 0.1 * Math.sin(phase);
        if (map.getLayer("signal-glow")) {
          map.setPaintProperty("signal-glow", "circle-opacity", opacity);
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
          18, 5, 24, 15, 30, 50, 38,
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
          16, 10, 22, 50, 28,
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
          1.5, ["+", ["*", ["get", "radius"], 1.6], 3],
          6, ["+", ["*", ["get", "radius"], 1.8], 4],
        ],
        "circle-opacity": [
          "interpolate", ["linear"], ["zoom"],
          1.5, ["*", ["get", "glowIntensity"], 0.6],
          4, ["get", "glowIntensity"],
          8, ["*", ["get", "glowIntensity"], 1.2],
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
          1.5, ["*", ["get", "radius"], 0.7],
          4, ["get", "radius"],
          8, ["*", ["get", "radius"], 1.3],
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

    // Hover highlight ring — activated via feature-state
    add({
      id: "marker-hover",
      type: "circle",
      source: "markets",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "transparent",
        "circle-radius": ["+", ["get", "radius"], 3],
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
      if (popupRef.current) popupRef.current.remove();
      popupRef.current = new maplibregl.Popup({ offset: 15, maxWidth: "320px" })
        .setLngLat(geom.coordinates as [number, number])
        .setHTML(buildPopupHtml(market))
        .addTo(map);
      // Notify parent about market selection
      if (onMarketClick) onMarketClick(market);
    });

    // Hover: feature-state highlight + cursor
    let hoveredId: string | number | null = null;
    map.on("mouseenter", "unclustered-point", (e) => {
      map.getCanvas().style.cursor = "pointer";
      if (e.features?.length) {
        const id = e.features[0].id;
        if (id !== undefined && id !== null) {
          hoveredId = id;
          map.setFeatureState({ source: "markets", id: hoveredId }, { hover: true });
        }
      }
    });
    map.on("mouseleave", "unclustered-point", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredId !== null) {
        map.setFeatureState({ source: "markets", id: hoveredId }, { hover: false });
        hoveredId = null;
      }
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

    // Compute log+sqrt area-proportional sizing (3–22px)
    const volumes = spaced.filter((m) => m.coords).map((m) => m.volume24h || m.volume || 0);
    volumes.sort((a, b) => a - b);

    const minR = 3, maxR = 22;
    const logMin = Math.log1p(volumes[0] || 0);
    const logMax = Math.log1p(volumes[volumes.length - 1] || 1);

    const features = spaced
      .filter((m) => m.coords)
      .map((m, i) => {
        const color = CATEGORY_COLORS[m.category] || CATEGORY_COLORS.Other;
        const vol = m.volume24h || m.volume || 0;

        // Log + sqrt scale: perceptually linear area sizing
        const logVol = Math.log1p(vol);
        const t = logMax > logMin ? (logVol - logMin) / (logMax - logMin) : 0;
        const radius = minR + Math.sqrt(t) * (maxR - minR);

        // Volume-scaled glow intensity
        const glowIntensity = 0.15 + t * 0.4; // 0.15–0.55

        const change = m.change ?? 0;
        const hasSignal = m.change !== null && Math.abs(m.change) > 0.05;
        const signalColor =
          m.change !== null && m.change > 0 ? "#22c55e" : "#ff4444";
        const signalRadius = hasSignal
          ? radius + 4 + Math.min(8, Math.abs(change) * 80)
          : 0;

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
          },
        };
      });

    source.setData({ type: "FeatureCollection", features });
  }, [markets, activeCategories, mapReady]);

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
      />
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
