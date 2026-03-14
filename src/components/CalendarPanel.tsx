"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProcessedMarket, Category } from "@/types";
import { CATEGORY_COLORS } from "@/lib/categories";

interface CalendarPanelProps {
  markets: ProcessedMarket[];
  onSelectMarket?: (slug: string) => void;
}

interface CalendarEvent {
  market: ProcessedMarket;
  endDate: Date;
  daysUntil: number;
}

type TimeGroup = "Today" | "Tomorrow" | "This Week" | "Next Week" | "This Month" | "Later";

const GROUP_ORDER: TimeGroup[] = ["Today", "Tomorrow", "This Week", "Next Week", "This Month", "Later"];

const CATEGORIES: Array<Category | "All"> = ["All", "Politics", "Crypto", "Sports", "Finance", "Tech", "Culture", "Other"];

function diffDays(a: Date, b: Date): number {
  const msPerDay = 86400000;
  const startOfA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const startOfB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((startOfA.getTime() - startOfB.getTime()) / msPerDay);
}

function assignGroup(daysUntil: number): TimeGroup {
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  if (daysUntil <= 7) return "This Week";
  if (daysUntil <= 14) return "Next Week";
  if (daysUntil <= 30) return "This Month";
  return "Later";
}

function urgencyColor(daysUntil: number): string {
  if (daysUntil < 1) return "#ff4444";
  if (daysUntil < 3) return "#f59e0b";
  if (daysUntil < 7) return "#eab308";
  return "var(--text-dim)";
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCountdown(days: number): string {
  if (days === 0) return "<1d";
  if (days === 1) return "1d";
  return `${days}d`;
}

function buildCalendar(markets: ProcessedMarket[], categoryFilter: Category | "All", now: Date): Map<TimeGroup, CalendarEvent[]> {
  const events: CalendarEvent[] = [];

  for (const market of markets) {
    if (!market.endDate || market.closed || !market.active) continue;
    if (categoryFilter !== "All" && market.category !== categoryFilter) continue;

    const endDate = new Date(market.endDate);
    if (isNaN(endDate.getTime())) continue;

    // Skip markets whose endDate has already passed
    if (endDate.getTime() < now.getTime()) continue;

    const daysUntil = diffDays(endDate, now);

    events.push({ market, endDate, daysUntil });
  }

  // Sort by date, then by impact
  events.sort((a, b) => a.daysUntil - b.daysUntil || b.market.impactScore - a.market.impactScore);

  const grouped = new Map<TimeGroup, CalendarEvent[]>();
  for (const event of events) {
    const group = assignGroup(event.daysUntil);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(event);
  }

  return grouped;
}

export default function CalendarPanel({ markets, onSelectMarket }: CalendarPanelProps) {
  const [categoryFilter, setCategoryFilter] = useState<Category | "All">("All");
  const [collapsed, setCollapsed] = useState<Set<TimeGroup>>(new Set());
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    // Refresh "now" every minute so groupings stay accurate
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const grouped = useMemo(
    () => buildCalendar(markets, categoryFilter, now),
    [markets, categoryFilter, now]
  );

  const totalEvents = useMemo(
    () => Array.from(grouped.values()).reduce((s, g) => s + g.length, 0),
    [grouped]
  );

  const toggleCollapse = (group: TimeGroup) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  return (
    <div className="font-mono">
      {/* Category filter */}
      <div className="flex flex-wrap gap-0.5 px-1.5 pb-1 mb-1 border-b border-[var(--border-subtle)]">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className="px-1.5 py-0 text-[9px] rounded transition-colors leading-[18px]"
            style={{
              background: categoryFilter === cat ? "rgba(34,197,94,0.15)" : "transparent",
              color: categoryFilter === cat ? "#22c55e" : "var(--text-faint)",
              border: `1px solid ${categoryFilter === cat ? "rgba(34,197,94,0.3)" : "transparent"}`,
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {totalEvents === 0 ? (
        <div className="text-[12px] text-[var(--text-ghost)] py-4 text-center">
          No upcoming events
        </div>
      ) : (
        <div>
          {GROUP_ORDER.map((group) => {
            const events = grouped.get(group);
            if (!events || events.length === 0) return null;
            const isCollapsed = collapsed.has(group);

            return (
              <div key={group}>
                {/* Group header */}
                <button
                  onClick={() => toggleCollapse(group)}
                  className="w-full flex items-center gap-1 px-1.5 py-1 text-[10px] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
                >
                  <span className="text-[9px]">{isCollapsed ? "\u25B6" : "\u25BC"}</span>
                  <span className="font-bold uppercase tracking-wide">{group}</span>
                  <span className="text-[var(--text-ghost)]">({events.length})</span>
                </button>

                {/* Events */}
                {!isCollapsed && (
                  <div className="space-y-0">
                    {events.map((ev) => {
                      const catColor = CATEGORY_COLORS[ev.market.category as keyof typeof CATEGORY_COLORS] || "var(--text-faint)";
                      const uColor = urgencyColor(ev.daysUntil);

                      return (
                        <div
                          key={ev.market.id}
                          className="flex items-center gap-2 px-1.5 py-[4px] border-b border-[var(--border-subtle)] last:border-0 cursor-pointer hover:bg-[var(--surface-hover)] transition-colors"
                          onClick={() => onSelectMarket?.(ev.market.slug)}
                        >
                          {/* Date + countdown */}
                          <div className="flex flex-col items-center shrink-0 w-10">
                            <span className="text-[9px] text-[var(--text-faint)] tabular-nums">
                              {formatDate(ev.endDate)}
                            </span>
                            <span className="text-[10px] font-bold tabular-nums" style={{ color: uColor }}>
                              {formatCountdown(ev.daysUntil)}
                            </span>
                          </div>

                          {/* Category dot */}
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: catColor }}
                          />

                          {/* Title */}
                          <span className="text-[11px] text-[var(--text-secondary)] truncate flex-1 min-w-0">
                            {ev.market.title}
                          </span>

                          {/* Current prob */}
                          {ev.market.prob !== null && (
                            <span className="text-[10px] tabular-nums text-[var(--text-dim)] shrink-0">
                              {(ev.market.prob * 100).toFixed(0)}%
                            </span>
                          )}

                          {/* Impact badge */}
                          {(ev.market.impactLevel === "critical" || ev.market.impactLevel === "high") && (
                            <span
                              className="text-[8px] px-1 rounded-sm shrink-0"
                              style={{
                                background: ev.market.impactLevel === "critical" ? "rgba(255,68,68,0.15)" : "rgba(245,158,11,0.15)",
                                color: ev.market.impactLevel === "critical" ? "#ff4444" : "#f59e0b",
                              }}
                            >
                              {ev.market.impactLevel}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
