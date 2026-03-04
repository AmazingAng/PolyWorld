"use client";

export type TimeRange = "1h" | "6h" | "24h" | "48h" | "7d" | "ALL";

interface TimeRangeFilterProps {
  active: TimeRange;
  onChange: (range: TimeRange) => void;
}

const OPTIONS: TimeRange[] = ["1h", "6h", "24h", "48h", "7d", "ALL"];

export default function TimeRangeFilter({
  active,
  onChange,
}: TimeRangeFilterProps) {
  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-0.5 bg-[#111827]/90 border border-[#1e293b] rounded-lg p-1 backdrop-blur-sm">
      {OPTIONS.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-2.5 py-1 rounded-md text-[13px] font-medium transition-all ${
            active === opt
              ? "bg-[#00d4ff]/20 text-[#00d4ff] border border-[#00d4ff]/30"
              : "text-[#64748b] hover:text-[#94a3b8] hover:bg-[#1a2332] border border-transparent"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
