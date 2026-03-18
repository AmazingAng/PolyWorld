"use client";

import { useState, useEffect, useRef } from "react";
import type { TimeRange } from "./TimeRangeFilter";
import { Category } from "@/types";
import { CATEGORY_COLORS, CATEGORY_SHAPES } from "@/lib/categories";
import ShapeIcon from "./ShapeIcon";
import { REGIONAL_VIEWS } from "@/lib/regions";
import type { ColorMode } from "./WorldMap";

const TIME_OPTIONS: TimeRange[] = ["1h", "6h", "24h", "48h", "7d", "ALL"];
const CATEGORIES: Category[] = ["Politics", "Crypto", "Sports", "Finance", "Tech", "Culture", "Other"];
const CATEGORY_EMOJI: Record<string, string> = {
  Politics: "🏛️", Crypto: "₿", Sports: "🏆", Finance: "📈", Tech: "💻", Culture: "🎭", Other: "🌐",
};

export type OverlayLayer =
  | "conflicts" | "intel" | "military" | "weather" | "natural" | "fires"
  | "elections" | "outages" | "protests"
  | "soccer" | "basketball" | "baseball" | "hockey" | "tennis" | "golf" | "combat";

const OVERLAY_LAYERS: { id: OverlayLayer; label: string; color: string }[] = [
  { id: "conflicts",  label: "💥 conflict zones",    color: "#ef4444" },
  { id: "military",   label: "✈️ military flights",  color: "#22d3ee" },
  { id: "protests",   label: "✊ protests / unrest", color: "#fb7185" },
  { id: "intel",      label: "🔍 intel hotspots",    color: "#a855f7" },
  { id: "outages",    label: "📡 internet outages",  color: "#e879f9" },
  { id: "elections",  label: "🗳️ elections",         color: "#fbbf24" },
  { id: "soccer",     label: "⚽ soccer",            color: "#10b981" },
  { id: "basketball", label: "🏀 basketball",        color: "#f97316" },
  { id: "baseball",   label: "⚾ baseball",          color: "#ef4444" },
  { id: "hockey",     label: "🏒 ice hockey",        color: "#38bdf8" },
  { id: "tennis",     label: "🎾 tennis",            color: "#a3e635" },
  { id: "golf",       label: "⛳ golf",              color: "#4ade80" },
  { id: "combat",     label: "🥊 boxing / MMA",      color: "#f43f5e" },
  { id: "weather",    label: "🌩️ weather alerts",    color: "#f59e0b" },
  { id: "natural",    label: "🌍 natural events",    color: "#f97316" },
  { id: "fires",      label: "🔥 fires",             color: "#ff6b35" },
];

interface MapToolbarProps {
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  activeCategories: Set<Category>;
  onToggleCategory: (cat: Category) => void;
  region?: string;
  onRegionChange?: (region: string) => void;
  colorMode?: ColorMode;
  onColorModeChange?: (mode: ColorMode) => void;
  activeLayers?: Set<OverlayLayer>;
  onToggleLayer?: (layer: OverlayLayer) => void;
}

export default function MapToolbar({
  timeRange,
  onTimeRangeChange,
  onToggleFullscreen,
  isFullscreen,
  activeCategories,
  onToggleCategory,
  region,
  onRegionChange,
  colorMode = "category",
  onColorModeChange,
  activeLayers,
  onToggleLayer,
}: MapToolbarProps) {
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);

  const regionRef    = useRef<HTMLDivElement>(null);
  const categoriesRef = useRef<HTMLDivElement>(null);
  const layersRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (regionRef.current && !regionRef.current.contains(e.target as Node)) setRegionOpen(false);
      if (categoriesRef.current && !categoriesRef.current.contains(e.target as Node)) setCategoriesOpen(false);
      if (layersRef.current && !layersRef.current.contains(e.target as Node)) setLayersOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const activeLayerCount = activeLayers?.size ?? 0;

  return (
    <>
      {/* Top-left: time range */}
      <div className="absolute top-2.5 left-2.5 z-10 font-mono">
        <div className="flex items-center gap-2 bg-[var(--bg)] border border-[var(--border)] rounded px-2.5 py-1.5 backdrop-blur-sm">
          <div className="flex items-center gap-0.5">
            {TIME_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => onTimeRangeChange(opt)}
                className={`px-2 py-1 text-[11px] font-mono border transition-all ${
                  timeRange === opt
                    ? "bg-[#22c55e] border-[#22c55e] text-[var(--bg)] font-bold"
                    : "border-[var(--border)] text-[var(--text-dim)] hover:border-[#22c55e] hover:text-[#22c55e]"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom-left: region + categories + layers */}
      <div className="absolute bottom-2.5 left-2.5 z-10 font-mono flex items-end gap-1.5">
        {/* Region selector */}
        <div className="relative" ref={regionRef}>
          <button
            onClick={() => setRegionOpen((p) => !p)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] transition-colors border backdrop-blur-sm ${
              regionOpen
                ? "bg-[#1e1e1e] text-[#ccc] border-[#2a2a2a]"
                : "bg-[#0a0a0a]/80 text-[#8a8a8a] border-[#1e1e1e] hover:text-[#a0a0a0]"
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22,12 17,3.4 7,3.4 2,12 7,20.6 17,20.6" />
              <path d="M2 12h20M12 3.4L16 12l-4 8.6M12 3.4L8 12l4 8.6" />
            </svg>
            REGION
          </button>
          {regionOpen && (
            <div className="map-toolbar-dropdown absolute bottom-full mb-1 left-0 bg-[#0a0a0a]/95 border border-[#2a2a2a] p-1 backdrop-blur-sm min-w-[148px] shadow-lg animate-fade-in max-h-64 overflow-y-auto">
              {REGIONAL_VIEWS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    onRegionChange?.(r.id);
                    setRegionOpen(false);
                  }}
                  className={`block w-full text-left px-2 py-1 text-[12px] hover:bg-[#fff]/5 transition-colors ${
                    region === r.id ? "text-[#22c55e]" : "text-[#999]"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Categories (was: Layers) */}
        <div className="relative" ref={categoriesRef}>
          <button
            onClick={() => setCategoriesOpen((p) => !p)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] transition-colors border backdrop-blur-sm ${
              categoriesOpen
                ? "bg-[#1e1e1e] text-[#ccc] border-[#2a2a2a]"
                : "bg-[#0a0a0a]/80 text-[#8a8a8a] border-[#1e1e1e] hover:text-[#a0a0a0]"
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
            </svg>
            CATEGORIES
          </button>
          {categoriesOpen && (
            <div className="map-toolbar-dropdown absolute bottom-full mb-1 left-0 bg-[#0a0a0a]/95 border border-[#2a2a2a] p-2 backdrop-blur-sm min-w-[168px] shadow-lg animate-fade-in max-h-72 overflow-y-auto">
              {/* Color mode toggle */}
              <div className="mb-2 pb-1.5 border-b border-[#2a2a2a]">
                <div className="text-[10px] uppercase tracking-wider text-[#666] mb-1">color by</div>
                <div className="flex gap-0.5">
                  {(["category", "impact"] as ColorMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => onColorModeChange?.(mode)}
                      className={`px-2 py-0.5 text-[11px] transition-colors ${
                        colorMode === mode
                          ? "text-[#ccc] bg-[#2a2a2a]"
                          : "text-[#777] hover:text-[#aaa]"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
              {CATEGORIES.map((cat) => {
                const active = activeCategories.has(cat);
                return (
                  <label
                    key={cat}
                    className="flex items-center gap-2 py-0.5 px-1 cursor-pointer hover:bg-[#fff]/5 transition-colors text-[12px]"
                    onClick={() => onToggleCategory(cat)}
                  >
                    <ShapeIcon
                      shape={CATEGORY_SHAPES[cat]}
                      color={active ? CATEGORY_COLORS[cat] : "#444"}
                      filled={active}
                      size={10}
                    />
                    <span className={active ? "text-[#ccc]" : "text-[#777]"}>
                      {CATEGORY_EMOJI[cat]} {cat.toLowerCase()}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Overlay Layers */}
        <div className="relative" ref={layersRef}>
          <button
            onClick={() => setLayersOpen((p) => !p)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] transition-colors border backdrop-blur-sm ${
              layersOpen
                ? "bg-[#1e1e1e] text-[#ccc] border-[#2a2a2a]"
                : activeLayerCount > 0
                ? "bg-[#1a1a2e] text-[#a78bfa] border-[#a78bfa]/40 hover:text-[#c4b5fd]"
                : "bg-[#0a0a0a]/80 text-[#8a8a8a] border-[#1e1e1e] hover:text-[#a0a0a0]"
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
            LAYERS
            {activeLayerCount > 0 && (
              <span className="text-[9px] font-bold text-[#a78bfa] bg-[#a78bfa]/20 rounded-full px-1 leading-none py-0.5">
                {activeLayerCount}
              </span>
            )}
          </button>
          {layersOpen && (
            <div className="map-toolbar-dropdown absolute bottom-full mb-1 left-0 bg-[#0a0a0a]/95 border border-[#2a2a2a] backdrop-blur-sm min-w-[182px] shadow-lg animate-fade-in max-h-80 overflow-y-auto">
              <div className="sticky top-0 bg-[#0a0a0a] px-2 pt-2 pb-1 border-b border-[#1a1a1a]">
                <div className="text-[10px] uppercase tracking-wider text-[#555]">intel overlays</div>
              </div>
              <div className="p-2">
              {OVERLAY_LAYERS.map(({ id, label, color }) => {
                const active = activeLayers?.has(id) ?? false;
                return (
                  <label
                    key={id}
                    className="flex items-center gap-2 py-0.5 px-1 cursor-pointer hover:bg-[#fff]/5 transition-colors text-[12px]"
                    onClick={() => onToggleLayer?.(id)}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 transition-all"
                      style={{
                        background: active ? color : "transparent",
                        border: `1.5px solid ${active ? color : "#444"}`,
                        boxShadow: active ? `0 0 4px ${color}80` : "none",
                      }}
                    />
                    <span className={active ? "text-[#ddd]" : "text-[#666]"}>
                      {label}
                    </span>
                  </label>
                );
              })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
