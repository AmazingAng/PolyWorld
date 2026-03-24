"use client";

import { useMemo, useState } from "react";
import type { ProcessedMarket } from "@/types";
import { detectArbitrage, type ArbitrageOpportunity } from "@/lib/arbitrage";
import { CATEGORY_COLORS } from "@/lib/categories";
import { useI18n } from "@/i18n";

interface ArbitragePanelProps {
  markets: ProcessedMarket[];
  onSelectMarket?: (slug: string) => void;
}

export default function ArbitragePanel({ markets, onSelectMarket }: ArbitragePanelProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);

  const opportunities = useMemo(() => detectArbitrage(markets), [markets]);

  const bestEdge = opportunities.length > 0 ? opportunities[0].impliedEdge : 0;

  if (opportunities.length === 0) {
    return (
      <div className="text-[12px] text-[var(--text-ghost)] py-4 text-center font-mono">
        {t("arbitrage.noOpportunities")}
      </div>
    );
  }

  return (
    <div className="font-mono">
      {/* Summary */}
      <div className="px-1.5 py-1 mb-1 text-[10px] text-[var(--text-dim)] border-b border-[var(--border-subtle)]">
        {t("arbitrage.opportunitiesFound", { count: opportunities.length, percent: (bestEdge * 100).toFixed(2) })}
      </div>

      {/* List */}
      <div className="space-y-0">
        {opportunities.map((opp) => (
          <ArbitrageRow
            key={opp.eventId}
            opp={opp}
            expanded={expanded === opp.eventId}
            onToggle={() => setExpanded(expanded === opp.eventId ? null : opp.eventId)}
            onSelect={() => onSelectMarket?.(opp.slug)}
          />
        ))}
      </div>
    </div>
  );
}

function ArbitrageRow({
  opp,
  expanded,
  onToggle,
  onSelect,
}: {
  opp: ArbitrageOpportunity;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const catColor = CATEGORY_COLORS[opp.category as keyof typeof CATEGORY_COLORS] || "var(--text-faint)";
  const deviationColor = opp.direction === "over" ? "#ff4444" : "#22c55e";

  return (
    <div className="border-b border-[var(--border-subtle)] last:border-0">
      <div
        className="flex items-center gap-2 px-1.5 py-[5px] cursor-pointer hover:bg-[var(--surface-hover)] transition-colors"
        onClick={onToggle}
      >
        {/* Category dot */}
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: catColor }}
          title={opp.category}
        />

        {/* Title */}
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className="text-[11px] text-[var(--text-secondary)] truncate flex-1 min-w-0 text-left hover:text-[var(--text)] transition-colors"
          title={opp.eventTitle}
        >
          {opp.eventTitle}
        </button>

        {/* Deviation */}
        <span className="text-[10px] tabular-nums shrink-0 font-bold" style={{ color: deviationColor }}>
          {opp.direction === "over" ? "+" : "-"}{(opp.deviation * 100).toFixed(2)}%
        </span>

        {/* Edge */}
        <span className="text-[10px] tabular-nums shrink-0 text-[#22c55e]">
          {(opp.impliedEdge * 100).toFixed(2)}%
        </span>

        {/* Expand arrow */}
        <span className="text-[10px] text-[var(--text-ghost)] shrink-0">
          {expanded ? "\u25B4" : "\u25BE"}
        </span>
      </div>

      {/* Expanded outcomes */}
      {expanded && (
        <div className="px-3 pb-2 space-y-0.5">
          {opp.outcomes.map((o, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <span className="text-[var(--text-faint)] truncate flex-1">{o.name}</span>
              <span className="tabular-nums text-[var(--text-dim)]">
                {(o.price * 100).toFixed(1)}%
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 text-[10px] pt-0.5 border-t border-[var(--border-subtle)]">
            <span className="text-[var(--text-faint)]">{t("arbitrage.sum")}</span>
            <span className="tabular-nums font-bold" style={{ color: deviationColor }}>
              {(opp.sumProb * 100).toFixed(1)}%
            </span>
            <span className="text-[var(--text-ghost)] ml-auto">
              liq: ${opp.liquidity >= 1000 ? `${(opp.liquidity / 1000).toFixed(0)}k` : opp.liquidity}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
