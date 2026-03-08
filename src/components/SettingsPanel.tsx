"use client";

import { Category } from "@/types";
import { CATEGORY_COLORS } from "@/lib/categories";
import type { TimeRange } from "./TimeRangeFilter";

const CATEGORIES: Category[] = [
  "Politics",
  "Crypto",
  "Sports",
  "Finance",
  "Tech",
  "Culture",
  "Other",
];

const TIME_OPTIONS: TimeRange[] = ["1h", "6h", "24h", "48h", "7d", "ALL"];

interface SettingsPanelProps {
  activeCategories: Set<Category>;
  onToggleCategory: (cat: Category) => void;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
}

export default function SettingsPanel({
  activeCategories,
  onToggleCategory,
  timeRange,
  onTimeRangeChange,
  autoRefresh,
  onToggleAutoRefresh,
}: SettingsPanelProps) {
  return (
    <div className="font-mono">
      {/* Categories */}
      <div className="mb-4">
        <div className="text-[13px] uppercase tracking-[0.15em] text-[#777] mb-2">
          categories
        </div>
        <div className="space-y-0.5">
          {CATEGORIES.map((cat) => {
            const active = activeCategories.has(cat);
            return (
              <label
                key={cat}
                className="flex items-center gap-2 py-1 px-1.5 cursor-pointer hover:bg-[#fff]/5 transition-colors text-[12px]"
                onClick={() => onToggleCategory(cat)}
              >
                <span
                  className="w-2 h-2 rounded-sm shrink-0 border"
                  style={{
                    background: active ? CATEGORY_COLORS[cat] : "transparent",
                    borderColor: active ? CATEGORY_COLORS[cat] : "#444",
                  }}
                />
                <span className={active ? "text-[#ccc]" : "text-[#777]"}>
                  {cat.toLowerCase()}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Time Range */}
      <div className="mb-4">
        <div className="text-[13px] uppercase tracking-[0.15em] text-[#777] mb-2">
          time range
        </div>
        <div className="flex flex-wrap gap-1">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => onTimeRangeChange(opt)}
              className={`px-2 py-1 text-[12px] border transition-colors ${
                timeRange === opt
                  ? "bg-[#fff]/10 text-[#e8e8e8] border-[#444]"
                  : "text-[#777] border-[#1e1e1e] hover:text-[#a0a0a0] hover:border-[#333]"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Auto-refresh */}
      <div className="mb-4">
        <div className="text-[13px] uppercase tracking-[0.15em] text-[#777] mb-2">
          auto-refresh
        </div>
        <button
          onClick={onToggleAutoRefresh}
          className={`flex items-center gap-2 px-2 py-1 text-[12px] border transition-colors ${
            autoRefresh
              ? "text-[#22c55e] border-[#22c55e]/30"
              : "text-[#777] border-[#1e1e1e]"
          }`}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: autoRefresh ? "#22c55e" : "#444",
            }}
          />
          {autoRefresh ? "on (45s)" : "off"}
        </button>
      </div>

      {/* Theme (placeholder) */}
      <div>
        <div className="text-[13px] uppercase tracking-[0.15em] text-[#777] mb-2">
          theme
        </div>
        <div className="text-[12px] text-[#8a8a8a] px-2 py-1 border border-[#1e1e1e]">
          dark (default)
        </div>
      </div>
    </div>
  );
}
