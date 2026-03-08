"use client";

import { useState, useEffect } from "react";
import type { TimeRange } from "./TimeRangeFilter";
import { Category } from "@/types";
import { CATEGORY_COLORS, CATEGORY_SHAPES } from "@/lib/categories";
import ShapeIcon from "./ShapeIcon";
import { REGIONAL_VIEWS } from "@/lib/regions";
import type { ColorMode } from "./WorldMap";

const TIME_OPTIONS: TimeRange[] = ["1h", "6h", "24h", "48h", "7d", "ALL"];
const CATEGORIES: Category[] = ["Politics", "Crypto", "Sports", "Finance", "Tech", "Culture", "Other"];

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
}: MapToolbarProps) {
  const [utcTime, setUtcTime] = useState("");
  const [layersOpen, setLayersOpen] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);

  useEffect(() => {
    const tick = () =>
      setUtcTime(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

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

      {/* Bottom-left: region + layers */}
      <div className="absolute bottom-2.5 left-2.5 z-10 font-mono flex items-end gap-1.5">
        {/* Region selector */}
        <div className="relative">
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
            {REGIONAL_VIEWS.find((r) => r.id === region)?.label || "Global"}
          </button>
          {regionOpen && (
            <div className="absolute bottom-full mb-1 left-0 bg-[#0a0a0a]/95 border border-[#2a2a2a] p-1 backdrop-blur-sm min-w-[120px] shadow-lg animate-fade-in">
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

        {/* Layers */}
        <div className="relative">
          <button
            onClick={() => setLayersOpen((p) => !p)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] transition-colors border backdrop-blur-sm ${
              layersOpen
                ? "bg-[#1e1e1e] text-[#ccc] border-[#2a2a2a]"
                : "bg-[#0a0a0a]/80 text-[#8a8a8a] border-[#1e1e1e] hover:text-[#a0a0a0]"
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
            layers
          </button>
          {layersOpen && (
            <div className="absolute bottom-full mb-1 left-0 bg-[#0a0a0a]/95 border border-[#2a2a2a] p-2 backdrop-blur-sm min-w-[160px] shadow-lg animate-fade-in">
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
                      {cat.toLowerCase()}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom-right: clock + fullscreen */}
      <div className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1.5 font-mono">
        <span className="text-[13px] text-[#777] tracking-wider select-none">
          {utcTime} UTC
        </span>
        <button
          onClick={onToggleFullscreen}
          className="w-[28px] h-[28px] flex items-center justify-center bg-[#0a0a0a]/80 border border-[#1e1e1e] text-[#8a8a8a] hover:text-[#e8e8e8] transition-colors backdrop-blur-sm"
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            {isFullscreen ? (
              <path d="M6 1v4H2M10 1v4h4M6 15v-4H2M10 15v-4h4" />
            ) : (
              <path d="M1 6V2h4M15 6V2h-4M1 10v4h4M15 10v4h-4" />
            )}
          </svg>
        </button>
      </div>
    </>
  );
}
