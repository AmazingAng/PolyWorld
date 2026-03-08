"use client";

import { useState, useRef, useEffect } from "react";
import { Category } from "@/types";
import { CATEGORY_COLORS, CATEGORY_SHAPES } from "@/lib/categories";
import ShapeIcon from "./ShapeIcon";

interface LayersPanelProps {
  activeCategories: Set<Category>;
  onToggle: (category: Category) => void;
}

const CATEGORIES: Category[] = [
  "Politics",
  "Crypto",
  "Sports",
  "Finance",
  "Tech",
  "Culture",
  "Other",
];

export default function LayersPanel({
  activeCategories,
  onToggle,
}: LayersPanelProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={panelRef} className="absolute bottom-2.5 left-2.5 z-10">
      {open && (
        <div className="mb-1.5 bg-[#0a0a0a]/90 border border-[#2a2a2a] p-2.5 backdrop-blur-sm min-w-[140px] shadow-lg animate-fade-in font-mono">
          <div className="text-[13px] uppercase tracking-[0.15em] text-[#777] mb-1.5">
            layers
          </div>
          {CATEGORIES.map((cat) => {
            const active = activeCategories.has(cat);
            return (
              <label
                key={cat}
                className="flex items-center gap-2 py-0.5 px-1 cursor-pointer hover:bg-[#fff]/5 transition-colors text-[12px]"
                onClick={() => onToggle(cat)}
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

      <button
        onClick={() => setOpen((prev) => !prev)}
        className={`flex items-center gap-1.5 px-2 py-1 text-[12px] font-mono transition-colors ${
          open
            ? "bg-[#1e1e1e] text-[#ccc] border border-[#2a2a2a]"
            : "bg-[#0a0a0a]/80 text-[#8a8a8a] border border-[#2a2a2a] hover:text-[#a0a0a0] hover:bg-[#1e1e1e]"
        } backdrop-blur-sm`}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
        layers
      </button>
    </div>
  );
}
