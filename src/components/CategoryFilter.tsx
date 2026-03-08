"use client";

import { Category } from "@/types";
import { CATEGORY_COLORS, CATEGORY_SHAPES } from "@/lib/categories";
import ShapeIcon from "./ShapeIcon";

interface CategoryFilterProps {
  active: Set<Category>;
  onToggle: (category: Category) => void;
}

const categories: Category[] = [
  "Politics",
  "Crypto",
  "Sports",
  "Finance",
  "Tech",
  "Culture",
  "Other",
];

export default function CategoryFilter({
  active,
  onToggle,
}: CategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-1 p-2.5 border-b border-[#1a1a1a] font-mono">
      {categories.map((cat) => {
        const isActive = active.has(cat);
        return (
          <button
            key={cat}
            onClick={() => onToggle(cat)}
            className={`text-[12px] px-1.5 py-0.5 transition-colors select-none ${
              isActive
                ? "text-[#ccc]"
                : "text-[#8a8a8a] hover:text-[#8a8a8a]"
            }`}
          >
            <ShapeIcon
              shape={CATEGORY_SHAPES[cat]}
              color={isActive ? CATEGORY_COLORS[cat] : "#333"}
              filled={isActive}
              size={8}
            />
            {cat.toLowerCase()}
          </button>
        );
      })}
    </div>
  );
}
