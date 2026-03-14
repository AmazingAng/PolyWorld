"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResolutionAlertInput } from "@/lib/signalEngine";

interface ResolutionPanelProps {
  onSelectMarket?: (slug: string) => void;
  categoryFilter: Set<string>;
  strengthFilter: Set<string>;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "<1m";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86400_000)}d`;
}

function strengthOf(alert: ResolutionAlertInput): "strong" | "moderate" | "weak" {
  if (!alert.endDate) return "weak";
  const hoursUntilEnd = (new Date(alert.endDate).getTime() - Date.now()) / 3600_000;
  if (hoursUntilEnd <= 24) return "strong";
  if (hoursUntilEnd <= 168) return "moderate";
  return "weak";
}

const STRENGTH_COLORS: Record<string, string> = {
  strong: "#ff4444",
  moderate: "#f59e0b",
  weak: "var(--text-dim)",
};
const STRENGTH_BG: Record<string, string> = {
  strong: "rgba(255,68,68,0.12)",
  moderate: "rgba(245,158,11,0.10)",
  weak: "rgba(128,128,128,0.08)",
};

/** Hook for page.tsx to get alert data + available categories for the dropdown */
export function useResolutionData() {
  const [alerts, setAlerts] = useState<ResolutionAlertInput[]>([]);
  const retryRef = useRef(0);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/resolution-alerts");
      if (!res.ok) return;
      const data = await res.json();
      setAlerts(
        (data.alerts || []).map((a: Record<string, unknown>) => ({
          id: a.id,
          eventId: a.event_id,
          title: a.title,
          url: a.url,
          source: a.source,
          detectedAt: a.detected_at,
          marketTitle: a.market_title || "",
          slug: a.slug || "",
          prob: a.prob ?? null,
          endDate: a.end_date ?? null,
          category: a.category ?? null,
        }))
      );
      retryRef.current = 0;
    } catch {
      if (retryRef.current < 2) {
        retryRef.current++;
        setTimeout(fetchAlerts, 3000);
      }
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const iv = setInterval(fetchAlerts, 120_000);
    return () => clearInterval(iv);
  }, [fetchAlerts]);

  const enriched = useMemo(
    () =>
      alerts.map((a) => ({ ...a, strength: strengthOf(a) })).sort((a, b) => {
        const sr = { strong: 3, moderate: 2, weak: 1 };
        const diff = sr[b.strength] - sr[a.strength];
        if (diff !== 0) return diff;
        return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
      }),
    [alerts]
  );

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const a of enriched) if (a.category) cats.add(a.category);
    return Array.from(cats).sort();
  }, [enriched]);

  return { enriched, totalCount: enriched.length, categories };
}

export default function ResolutionPanel({ onSelectMarket, categoryFilter, strengthFilter }: ResolutionPanelProps) {
  const { enriched } = useResolutionData();

  const filtered = useMemo(() => {
    let result = enriched;
    if (strengthFilter.size > 0) result = result.filter((a) => strengthFilter.has(a.strength));
    if (categoryFilter.size > 0) result = result.filter((a) => a.category && categoryFilter.has(a.category));
    return result;
  }, [enriched, categoryFilter, strengthFilter]);

  return (
    <div className="font-mono">
      {filtered.length === 0 ? (
        <div className="text-[12px] text-[var(--text-ghost)] py-4 text-center">
          No resolution alerts
        </div>
      ) : (
        <div className="space-y-0">
          {filtered.map((alert) => (
            <div
              key={alert.id}
              className="border-b border-[var(--border-subtle)] last:border-0"
              style={{ background: alert.strength === "strong" ? "rgba(255,68,68,0.03)" : undefined }}
            >
              <div className="px-1.5 py-[5px]">
                <div className="flex items-center gap-1 mb-0.5">
                  <span
                    className="text-[8px] font-bold rounded-sm px-0.5 leading-[14px]"
                    style={{ background: STRENGTH_BG[alert.strength], color: STRENGTH_COLORS[alert.strength] }}
                  >
                    {alert.strength.slice(0, 3).toUpperCase()}
                  </span>
                  <span className="text-[9px] font-bold text-[var(--text-faint)] uppercase tracking-wide">
                    {alert.source}
                  </span>
                  {alert.prob !== null && (
                    <span className="text-[9px] tabular-nums text-[var(--text-dim)]">
                      @{(alert.prob * 100).toFixed(0)}%
                    </span>
                  )}
                  <span className="text-[9px] text-[var(--text-ghost)] ml-auto shrink-0">
                    {timeAgo(new Date(alert.detectedAt).getTime())}
                  </span>
                </div>

                <a
                  href={alert.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-[var(--text-secondary)] leading-tight hover:text-[var(--text)] transition-colors block"
                >
                  {alert.title}
                </a>

                <button
                  onClick={() => onSelectMarket?.(alert.slug)}
                  className="text-[10px] text-[var(--green,#22c55e)] hover:underline truncate block max-w-full text-left mt-0.5"
                >
                  {alert.marketTitle}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
