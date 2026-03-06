"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { ProcessedMarket, PolymarketMarket, SmartMoneyFlow } from "@/types";
import { CATEGORY_COLORS } from "@/lib/categories";
import { formatVolume, formatPct, formatChange } from "@/lib/format";
import Sparkline from "./Sparkline";

interface MarketDetailPanelProps {
  market: ProcessedMarket;
  relatedMarkets: ProcessedMarket[];
  onBack: () => void;
  onSelectMarket: (market: ProcessedMarket) => void;
  onTagClick?: (tag: string) => void;
}

function formatEndDate(d: string | null): string {
  if (!d) return "\u2014";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "\u2014";
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 0) return "ended";
  if (diffHours < 24) return "today";
  const days = Math.ceil(diffHours / 24);
  if (days === 1) return "tomorrow";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

const STOP_WORDS = new Set(["the", "of", "and", "in", "a", "an", "to", "for", "by", "on", "at"]);
const ORG_WORDS = new Set(["party", "congress", "council", "committee", "union", "league", "association", "club", "team", "united", "city", "republic", "democratic", "communist", "national", "workers", "people", "socialist", "liberal", "conservative", "federal", "reserve", "corporation", "company", "group", "foundation", "institute", "movement", "front", "alliance", "coalition"]);

/** Abbreviate an entity/label string Polymarket-style */
function makeAbbrev(entity: string): string {
  const paren = entity.match(/\(([^)]+)\)/);
  if (paren) return paren[1];
  if (entity.length <= 8) return entity;
  const words = entity.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 1) return entity.slice(0, 6);
  // Person name: 2-3 capitalized words, none are org-indicator words
  const hasOrgWord = words.some(w => ORG_WORDS.has(w.toLowerCase()));
  const looksLikePerson = !hasOrgWord && words.length <= 3 && words.every(w => /^[A-Z]/.test(w) && !STOP_WORDS.has(w.toLowerCase()));
  if (looksLikePerson) {
    if (words.length === 2) return words[0][0] + ". " + words[1];
    return words.slice(0, -1).map(w => w.length <= 2 ? w : w[0] + ".").join("") + " " + words[words.length - 1];
  }
  // Organization: initials of significant words
  const sig = words.filter(w => !STOP_WORDS.has(w.toLowerCase()));
  if (sig.length >= 2) {
    const initials = sig.map(w => w[0].toUpperCase()).join("");
    if (initials.length <= 5) return initials;
  }
  return words[0].slice(0, 5);
}

/** Find the longest common prefix of an array of strings */
function commonPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  let prefix = strs[0];
  for (let i = 1; i < strs.length; i++) {
    while (!strs[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return "";
    }
  }
  return prefix;
}

/** Find the longest common suffix of an array of strings */
function commonSuffix(strs: string[]): string {
  const rev = strs.map(s => [...s].reverse().join(""));
  const p = commonPrefix(rev);
  return [...p].reverse().join("");
}

/**
 * For an array of multi-binary questions, extract a short label for each.
 * 1. Extract entity from each question.
 * 2. If all entities are the same → extract the differing part instead.
 * 3. Abbreviate the result.
 */
function extractLabels(questions: string[]): { label: string; full: string }[] {
  if (questions.length === 0) return [];

  // Step 1: try entity extraction
  const entities = questions.map(q => {
    const m = q.match(/^Will\s+(?:the\s+)?(.+?)\s+(?:win|be |become |get |have |receive |reach |finish |place |make |qualify|decrease|increase|remain|stay|announce|sign|join|leave|pass|drop|exceed|hit|go |land |crash|end |start|launch|release|achieve|clinch|secure|earn|take )/i);
    if (m) return m[1].trim();
    const m2 = q.match(/^Will there be\s+(.+?)(?:\?|$)/i);
    if (m2) return m2[1].trim();
    return q.replace(/^Will\s+/i, "").replace(/\?$/, "").trim();
  });

  // Step 2: check if all entities are the same
  const allSame = entities.every(e => e === entities[0]);

  if (!allSame) {
    // Entities differ → abbreviate each entity
    return entities.map(e => ({ label: makeAbbrev(e), full: e }));
  }

  // All same entity → find the varying part of questions
  const pre = commonPrefix(questions);
  const suf = commonSuffix(questions);
  const diffs = questions.map(q => {
    let d = q.slice(pre.length, q.length - suf.length).trim();
    // Clean up: remove trailing/leading common words
    d = d.replace(/^(?:between\s+)?/i, "").replace(/\s+seats?$/i, "");
    return d;
  });

  // Condense range expressions: "90 and 104" → "90-104"
  const labels = diffs.map(d => {
    const range = d.match(/^(\d+)\s+and\s+(\d+)$/);
    if (range) return `${range[1]}-${range[2]}`;
    const lt = d.match(/^less than\s+(\d+)$/i);
    if (lt) return `<${lt[1]}`;
    const gt = d.match(/^(?:more than|over|above)\s+(\d+)$/i);
    if (gt) return `>${gt[1]}`;
    const gte = d.match(/^(\d+)\s+or\s+more$/i);
    if (gte) return `${gte[1]}+`;
    const lte = d.match(/^(\d+)\s+or\s+(?:less|fewer)$/i);
    if (lte) return `≤${lte[1]}`;
    const noChange = d.match(/^no\s+/i);
    if (noChange) return d.slice(0, 10);
    if (d.length <= 10) return d;
    return makeAbbrev(d);
  });

  return labels.map((label, i) => ({ label, full: diffs[i] || questions[i] }));
}

/** Check if all sub-markets are binary Yes/No */
function isMultiBinary(markets: PolymarketMarket[]): boolean {
  if (markets.length < 2) return false;
  return markets.every(m => {
    let labels: string[] = [];
    if (Array.isArray(m.outcomes)) labels = m.outcomes;
    else if (typeof m.outcomes === "string") {
      try { labels = JSON.parse(m.outcomes); } catch { return false; }
    }
    return labels.length === 2 && labels[0] === "Yes" && labels[1] === "No";
  });
}

interface ParsedOutcome {
  m: PolymarketMarket;
  idx: number;
  yesPrice: number;
  entity: string;
  abbr: string;
  mChg: ReturnType<typeof formatChange>;
  isWinner: boolean;
}

export default function MarketDetailPanel({
  market,
  relatedMarkets,
  onBack,
  onSelectMarket,
  onTagClick,
}: MarketDetailPanelProps) {
  const color = CATEGORY_COLORS[market.category] || CATEGORY_COLORS.Other;
  const chg = formatChange(market.change);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [chartHours, setChartHours] = useState(24);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(true);

  // Reset AI summary when market changes
  useEffect(() => {
    setAiSummary(null);
    setAiExpanded(true);
  }, [market.id]);

  const fetchAiSummary = useCallback(async () => {
    if (aiLoading) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "market",
          cacheKey: `market:${market.id}`,
          context: {
            title: market.title,
            prob: market.prob,
            change: market.change,
            volume: market.volume,
            volume24h: market.volume24h,
            description: market.description,
            relatedTitles: relatedMarkets.slice(0, 3).map((m) => m.title),
          },
        }),
      });
      const data = await res.json();
      if (data.summary) {
        setAiSummary(data.summary);
      } else if (data.error) {
        setAiSummary(`Error: ${data.error}`);
      }
    } catch (err) {
      setAiSummary("Failed to generate summary");
    }
    setAiLoading(false);
  }, [market, relatedMarkets, aiLoading]);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const [chartWidth, setChartWidth] = useState(240);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(Math.floor(e.contentRect.width));
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setChartWidth(Math.floor(e.contentRect.width - 16));
    });
    obs.observe(chartRef.current);
    return () => obs.disconnect();
  }, []);

  const isWide = containerWidth >= 520;
  const activeMarketsList = useMemo(() => market.markets.filter(m => m.active !== false), [market.markets]);
  const hasOutcomes = activeMarketsList.length > 0;
  const multiBinary = useMemo(() => isMultiBinary(activeMarketsList), [activeMarketsList]);

  // Top option label (the one whose Yes price matches market.prob)
  const topOptionLabel = useMemo(() => {
    if (activeMarketsList.length < 2) return null;
    let best: { label: string; prob: number } | null = null;
    for (const m of activeMarketsList) {
      let yesPrice = 0;
      try {
        const raw = m.outcomePrices
          ? Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices)
          : null;
        if (raw) yesPrice = parseFloat(raw[0]);
      } catch { /* skip */ }
      if (isNaN(yesPrice)) continue;
      if (!best || yesPrice > best.prob) {
        let label = m.groupItemTitle || "";
        // Without groupItemTitle, strip event title prefix from question
        if (!m.groupItemTitle && m.question && market.title) {
          if (m.question === market.title) {
            label = ""; // same as event title, skip
          } else if (m.question.startsWith(market.title)) {
            label = m.question.slice(market.title.length).replace(/^[\s\-:·]+/, "").trim();
          } else {
            label = m.question;
          }
        }
        best = { label, prob: yesPrice };
      }
    }
    return best?.label || null;
  }, [activeMarketsList, market.title]);

  // Parse outcomes for multi-binary display
  const parsedOutcomes = useMemo((): ParsedOutcome[] => {
    if (!multiBinary) return [];
    // Filter out inactive sub-markets (e.g. placeholder "Person C" options)
    const activeMarkets = market.markets.filter(m => m.active !== false);
    // Use groupItemTitle from API if available, otherwise fall back to extractLabels
    const hasGroupTitles = activeMarkets.some(m => m.groupItemTitle);
    const fallbackLabels = hasGroupTitles
      ? null
      : extractLabels(activeMarkets.map(m => m.question || ""));
    return activeMarkets.map((m, idx) => {
      let prices: number[] = [];
      try {
        const raw = m.outcomePrices
          ? Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices)
          : null;
        if (raw) prices = raw.map((p: string) => parseFloat(p));
      } catch { /* skip */ }
      const yesPrice = prices[0] ?? 0;
      const abbr = m.groupItemTitle || (fallbackLabels ? fallbackLabels[idx]?.label : "") || "?";
      const entity = m.groupItemTitle || (fallbackLabels ? fallbackLabels[idx]?.full : "") || m.question || "";
      const mChg = formatChange(
        m.oneDayPriceChange !== undefined ? parseFloat(String(m.oneDayPriceChange)) : null
      );
      const isWinner = market.closed && yesPrice >= 0.99;
      return { m, idx, yesPrice, entity, abbr, mChg, isWinner };
    }).sort((a, b) => b.yesPrice - a.yesPrice);
  }, [market.markets, market.closed, multiBinary]);

  // Parse outcomes for regular (non-multi-binary) display
  const regularCards = useMemo(() => {
    if (multiBinary) return [];
    return market.markets.filter(m => m.active !== false).map((m, i) => {
      let prices: number[] = [];
      let outcomeLabels: string[] = [];
      try {
        const raw = m.outcomePrices
          ? Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices)
          : null;
        if (raw) prices = raw.map((p: string) => parseFloat(p));
      } catch { /* skip */ }
      const rawOutcomes = m.outcomes;
      if (Array.isArray(rawOutcomes)) outcomeLabels = rawOutcomes;
      else if (typeof rawOutcomes === "string") {
        try { outcomeLabels = JSON.parse(rawOutcomes); } catch { outcomeLabels = []; }
      } else {
        outcomeLabels = prices.length === 2 ? ["Yes", "No"] : [];
      }
      const mChg = formatChange(
        m.oneDayPriceChange !== undefined ? parseFloat(String(m.oneDayPriceChange)) : null
      );
      const isResolved = market.closed && prices.length > 0;
      const winnerIdx = isResolved ? prices.findIndex(p => p >= 0.99) : -1;
      return { m, i, prices, outcomeLabels, mChg, winnerIdx };
    });
  }, [market.markets, market.closed, multiBinary]);

  // Compute label column width: fit the longest label, with min/max bounds
  const labelColWidth = useMemo(() => {
    if (parsedOutcomes.length === 0) return 56;
    const maxLen = Math.max(...parsedOutcomes.map(o => o.abbr.length));
    // ~7px per character at 11px monospace, plus 4px padding
    // Allow up to 200px for longer labels (sports markets etc.)
    return Math.max(48, Math.min(200, maxLen * 7 + 4));
  }, [parsedOutcomes]);

  // If labels are very long, use a stacked layout (label above bar) instead of inline
  const stackedLayout = useMemo(() => {
    if (parsedOutcomes.length === 0) return false;
    const maxLen = Math.max(...parsedOutcomes.map(o => o.abbr.length));
    return maxLen > 20;
  }, [parsedOutcomes]);

  // --- Multi-binary outcomes: compact Polymarket-style list ---
  const multiBinaryContent = multiBinary && (
    <div className={stackedLayout ? "space-y-2.5" : "space-y-2"}>
      {parsedOutcomes.map(({ m, idx, yesPrice, entity, abbr, mChg, isWinner }) => {
        const pct = yesPrice * 100;
        const barColor = isWinner ? "#22c55e" : color;
        const vol24h = parseFloat(String(m.volume_24hr || m.volume || 0));
        const liq = parseFloat(String(m.liquidity || 0));
        return (
          <div
            key={m.id || idx}
            className={`px-2 rounded-sm hover:bg-[var(--surface)] transition-colors ${stackedLayout ? "py-2.5 border-b border-[var(--border-subtle)] last:border-0" : "py-2 border-b border-[var(--border-subtle)] last:border-0"}`}
            title={entity}
          >
            {stackedLayout ? (
              <>
                {/* Stacked: label on its own line */}
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[11px] font-medium ${isWinner ? "text-[#22c55e]" : "text-[var(--text-secondary)]"}`}>
                    {abbr}
                  </span>
                  <span className={`text-[11px] tabular-nums ${isWinner ? "text-[#22c55e] font-bold" : "text-[var(--text-dim)]"}`}>
                    {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-3.5 bg-[var(--bg)] rounded-sm relative overflow-hidden border border-[var(--border-subtle)] mb-1">
                  <div
                    className="h-full rounded-sm transition-all duration-500 ease-out"
                    style={{
                      width: `${Math.max(pct, 1)}%`,
                      background: `linear-gradient(90deg, ${barColor}aa, ${barColor}55)`,
                    }}
                  />
                </div>
                <div className="flex items-center gap-3 text-[10px] tabular-nums text-[var(--text-faint)]">
                  <span className={mChg.cls === "up" ? "text-[#22c55e]" : mChg.cls === "down" ? "text-[#ff4444]" : ""}>
                    {mChg.text}
                  </span>
                  <span>vol {formatVolume(vol24h)}</span>
                  <span>liq {formatVolume(liq)}</span>
                </div>
              </>
            ) : (
              <>
                {/* Inline: label + bar + percentage on one row */}
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[11px] shrink-0 truncate font-medium cursor-default ${isWinner ? "text-[#22c55e]" : "text-[var(--text-secondary)]"}`}
                    style={{ width: labelColWidth }}
                  >
                    {abbr}
                  </span>
                  <div className="flex-1 h-3.5 bg-[var(--bg)] rounded-sm relative overflow-hidden border border-[var(--border-subtle)]">
                    <div
                      className="h-full rounded-sm transition-all duration-500 ease-out"
                      style={{
                        width: `${Math.max(pct, 1)}%`,
                        background: `linear-gradient(90deg, ${barColor}aa, ${barColor}55)`,
                      }}
                    />
                  </div>
                  <span className={`text-[11px] w-11 text-right tabular-nums shrink-0 ${isWinner ? "text-[#22c55e] font-bold" : "text-[var(--text-dim)]"}`}>
                    {pct.toFixed(1)}%
                  </span>
                </div>
                {/* Row 2: stats */}
                <div className="flex items-center gap-3 text-[10px] tabular-nums mt-0.5" style={{ paddingLeft: labelColWidth + 8 }}>
                  <span className={mChg.cls === "up" ? "text-[#22c55e]" : mChg.cls === "down" ? "text-[#ff4444]" : "text-[var(--text-faint)]"}>
                    {mChg.text}
                  </span>
                  <span className="text-[var(--text-faint)]">
                    vol {formatVolume(vol24h)}
                  </span>
                  <span className="text-[var(--text-faint)]">
                    liq {formatVolume(liq)}
                  </span>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  // --- Regular outcomes: card-based display ---
  const regularContent = !multiBinary && hasOutcomes && (
    <div className="space-y-2">
      {regularCards.map(({ m, i, prices, outcomeLabels, mChg, winnerIdx }) => {
        let cardTitle = m.groupItemTitle || m.question || "\u2014";
        // Strip redundant event title prefix from question
        if (!m.groupItemTitle && m.question && market.title) {
          const q = m.question;
          const prefix = market.title;
          if (q === prefix) {
            cardTitle = q; // same as event — show as-is
          } else if (q.startsWith(prefix)) {
            const suffix = q.slice(prefix.length).replace(/^[\s\-:·]+/, "").trim();
            if (suffix) cardTitle = suffix;
          }
        }
        const maxLabelLen = Math.max(...outcomeLabels.map(l => l.length), 0);
        const regLabelW = Math.max(48, Math.min(200, maxLabelLen * 7 + 4));
        const regStacked = maxLabelLen > 16;
        return (
        <div key={m.id || i} className="border border-[var(--border-subtle)] rounded-sm px-3 py-2.5 text-[12px]">
          <div className="text-[var(--text)] font-bold text-[13px] line-clamp-2 mb-2" title={m.question || ""}>
            {cardTitle}
          </div>
          {prices.length > 0 && outcomeLabels.length > 0 ? (
            <div className={regStacked ? "space-y-2" : "space-y-1.5"}>
              {outcomeLabels.map((label, j) => {
                const pct = prices[j] != null ? prices[j] * 100 : 0;
                const isW = winnerIdx === j;
                const barColor = isW ? "#22c55e" : j === 0 ? color : "#6b7280";
                return regStacked ? (
                  <div key={j}>
                    <div className={`text-[11px] mb-0.5 ${isW ? "text-[#22c55e] font-bold" : "text-[var(--text-dim)]"}`} title={label}>
                      {label}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-4 bg-[var(--bg)] rounded-sm relative overflow-hidden border border-[var(--border-subtle)]">
                        <div
                          className="h-full rounded-sm transition-all duration-500 ease-out"
                          style={{
                            width: `${Math.max(pct, 2)}%`,
                            background: `linear-gradient(90deg, ${barColor}${isW ? "dd" : "99"}, ${barColor}${isW ? "aa" : "55"})`,
                            boxShadow: pct > 10 ? `0 0 8px ${barColor}30` : "none",
                          }}
                        />
                        {pct > 30 && (
                          <span className="absolute inset-y-0 left-1.5 flex items-center text-[10px] font-bold" style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                            {pct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                      {pct <= 30 && (
                        <span className={`text-[11px] w-10 text-right tabular-nums ${isW ? "text-[#22c55e]" : "text-[var(--text-secondary)]"}`}>
                          {pct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div key={j} className="flex items-center gap-2">
                    <span className={`text-[11px] shrink-0 truncate ${isW ? "text-[#22c55e] font-bold" : "text-[var(--text-dim)]"}`} style={{ width: regLabelW }} title={label}>
                      {label}
                    </span>
                    <div className="flex-1 h-4 bg-[var(--bg)] rounded-sm relative overflow-hidden border border-[var(--border-subtle)]">
                      <div
                        className="h-full rounded-sm transition-all duration-500 ease-out"
                        style={{
                          width: `${Math.max(pct, 2)}%`,
                          background: `linear-gradient(90deg, ${barColor}${isW ? "dd" : "99"}, ${barColor}${isW ? "aa" : "55"})`,
                          boxShadow: pct > 10 ? `0 0 8px ${barColor}30` : "none",
                        }}
                      />
                      {pct > 30 && (
                        <span className="absolute inset-y-0 left-1.5 flex items-center text-[10px] font-bold" style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                          {pct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    {pct <= 30 && (
                      <span className={`text-[11px] w-10 text-right tabular-nums ${isW ? "text-[#22c55e]" : "text-[var(--text-secondary)]"}`}>
                        {pct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">{prices[0] != null ? formatPct(prices[0]) : "\u2014"}</span>
              <span className={mChg.cls === "up" ? "text-[#22c55e]" : mChg.cls === "down" ? "text-[#ff4444]" : "text-[var(--text-faint)]"}>{mChg.text}</span>
            </div>
          )}
          <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-faint)]">
            {m.volume && <span>vol {formatVolume(parseFloat(String(m.volume)))}</span>}
            {m.liquidity && <span>{"\u00B7"} liq {formatVolume(parseFloat(String(m.liquidity)))}</span>}
            {mChg.text !== "\u2014" && <span>{"\u00B7"} {mChg.text}</span>}
            <a href={`https://polymarket.com/event/${encodeURIComponent(market.slug)}`} target="_blank" rel="noopener noreferrer" className="text-[var(--text-ghost)] hover:text-[var(--text-dim)] ml-auto transition-colors">
              trade {"\u2192"}
            </a>
          </div>
        </div>
        );
      })}
    </div>
  );

  const outcomesContent = multiBinary ? multiBinaryContent : regularContent;

  // Secondary panel flags
  const hasRules = !!market.description;
  const hasTags = market.tags.length > 0;
  const hasCreated = !!market.createdAt;
  const hasRelated = relatedMarkets.length > 0;
  const hasSecondary = hasRules || hasTags || hasCreated || hasRelated;

  return (
    <div className="font-mono" ref={containerRef}>
      {/* ============ PRIMARY PANEL ============ */}
      <div className={`flex gap-5 ${isWide && hasOutcomes ? "flex-row items-stretch" : "flex-col"}`}>

        {/* Left: info + chart */}
        <div className={`min-w-0 flex flex-col gap-4 ${isWide && hasOutcomes ? "flex-1" : ""}`}>
          {/* Header */}
          <div className="flex items-start gap-3">
            {market.image ? (
              <img src={market.image} alt="" className="w-10 h-10 rounded-md object-cover shrink-0 border border-[var(--border)]" />
            ) : (
              <div className="w-10 h-10 rounded-md shrink-0 flex items-center justify-center text-[16px] font-bold border border-[var(--border)]" style={{ background: `${color}18`, color }}>
                {market.title.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] mb-1 flex-wrap">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                {market.category.toLowerCase()}
                {market.location && <span className="text-[var(--text-faint)]">{"\u00B7"} {market.location.toLowerCase()}</span>}
                {(market.closed || (market.endDate && new Date(market.endDate).getTime() < Date.now())) ? (
                  <span className="text-[11px] px-1.5 py-0.5 bg-[#ff4444]/10 text-[#ff4444] border border-[#ff4444]/20 uppercase rounded-sm">closed</span>
                ) : market.active ? (
                  <span className="text-[11px] px-1.5 py-0.5 bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20 uppercase rounded-sm">active</span>
                ) : null}
                {market.endDate && <span className="text-[var(--text-faint)]">{"\u00B7"} {formatEndDate(market.endDate)}</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-[13px] text-[var(--text)] leading-[1.5]">{market.title}</h2>
                <button
                  onClick={fetchAiSummary}
                  disabled={aiLoading}
                  className="shrink-0 text-[var(--text-faint)] hover:text-[#f59e0b] transition-colors disabled:opacity-50"
                  title="AI Summary"
                >
                  {aiLoading ? (
                    <span className="inline-block w-3 h-3 border border-[#f59e0b] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="text-[14px]">{"\u2728"}</span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* AI Summary */}
          {aiSummary && (
            <div className="border border-[#f59e0b]/20 bg-[#f59e0b]/5 rounded-sm px-3 py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-[#f59e0b]">{"\u2728"} ai summary</span>
                <button
                  onClick={() => setAiExpanded(!aiExpanded)}
                  className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text-muted)]"
                >
                  {aiExpanded ? "collapse" : "expand"}
                </button>
              </div>
              {aiExpanded && (
                <p className="text-[12px] text-[var(--text-dim)] leading-[1.6]">{aiSummary}</p>
              )}
            </div>
          )}

          {/* Prob + Stats */}
          <div>
            <div className="flex items-baseline gap-3 mb-1.5 flex-wrap">
              <span className="text-[24px] text-[var(--text)] font-bold tracking-tight">
                {market.prob !== null ? formatPct(market.prob) : "\u2014"}
              </span>
              {topOptionLabel && (
                <span className="text-[13px] text-[var(--text-muted)]" title={topOptionLabel}>
                  {topOptionLabel}
                </span>
              )}
              <span className={`text-[13px] ${chg.cls === "up" ? "text-[#22c55e]" : chg.cls === "down" ? "text-[#ff4444]" : "text-[var(--text-faint)]"}`}>
                {chg.text}<span className="text-[11px] text-[var(--text-faint)] ml-0.5">24h</span>
              </span>
            </div>
            <div className="flex gap-4 text-[11px] text-[var(--text-muted)] tabular-nums">
              <span>Vol {formatVolume(market.volume)}</span>
              <span>24h {formatVolume(market.volume24h)}</span>
              <span>Liq {formatVolume(market.liquidity)}</span>
            </div>
          </div>

          {market.closed && hasOutcomes && <ResolutionBanner markets={activeMarketsList} />}

          {/* Chart */}
          <div ref={chartRef} className="flex-1 min-h-0">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)]">price</div>
              <div className="flex gap-0.5 bg-[var(--bg)] border border-[var(--border-subtle)] rounded-sm p-0.5">
                {[1, 24, 168, 720].map((h) => (
                  <button
                    key={h}
                    onClick={() => setChartHours(h)}
                    className={`px-1.5 py-0.5 text-[11px] rounded-sm transition-all ${chartHours === h ? "text-[var(--text)] bg-[var(--surface-hover)] font-semibold" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
                  >
                    {h === 1 ? "1h" : h === 24 ? "24h" : h === 168 ? "7d" : "30d"}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-[var(--bg)] border border-[var(--border)] rounded-sm p-2" style={{ boxShadow: "inset 0 1px 4px rgba(0,0,0,0.3)" }}>
              <Sparkline eventId={market.id} hours={chartHours} width={chartWidth > 0 ? chartWidth : 240} height={200} multiSeries={activeMarketsList.length > 1} />
            </div>
          </div>
        </div>

        {/* Right: outcomes (scrollable) */}
        {isWide && hasOutcomes && (
          <div className="shrink-0 flex flex-col" style={{ width: "42%", minWidth: 200, maxWidth: 380 }}>
            <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-2">
              outcomes ({activeMarketsList.length})
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1" style={{ maxHeight: 460 }}>
              {outcomesContent}
            </div>
          </div>
        )}
      </div>

      {/* Outcomes (narrow: stacked below) */}
      {!isWide && hasOutcomes && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-2">
            outcomes ({activeMarketsList.length})
          </div>
          {outcomesContent}
        </div>
      )}

      {/* ============ SECONDARY PANEL ============ */}
      {hasSecondary && (
        <div className="mt-8 pt-5 border-t border-[var(--border)]">
          <div className="grid gap-5" style={{ gridTemplateColumns: isWide ? "1fr 1fr" : "1fr" }}>
            {hasRules && (
              <div className="border border-[var(--border-subtle)] rounded-sm px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-2">rules</div>
                <div className={`text-[12px] text-[var(--text-dim)] leading-[1.7] ${!rulesExpanded ? "line-clamp-1" : ""}`}>
                  {market.description}
                </div>
                {market.description && market.description.length > 60 && (
                  <button onClick={() => setRulesExpanded(!rulesExpanded)} className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] mt-1.5 transition-colors">
                    {rulesExpanded ? "collapse" : "expand"}
                  </button>
                )}
                {market.resolutionSource && (
                  <div className="mt-2 text-[11px] text-[var(--text-faint)]">
                    source: <span className="text-[var(--text-dim)]">{market.resolutionSource}</span>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-4">
              {hasTags && (
                <div className="border border-[var(--border-subtle)] rounded-sm px-3 py-3">
                  <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-2">tags</div>
                  <div className="flex flex-wrap gap-1.5">
                    {market.tags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => onTagClick?.(tag)}
                        className="text-[11px] px-2 py-0.5 border border-[var(--border)] text-[var(--text-dim)] rounded-sm hover:border-[#22c55e]/50 hover:text-[#22c55e] transition-colors cursor-pointer"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {hasCreated && (
                <div className="border border-[var(--border-subtle)] rounded-sm px-3 py-3">
                  <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-1">created</div>
                  <div className="text-[12px] text-[var(--text-dim)]">
                    {new Date(market.createdAt!).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {hasRelated && (
            <div className="mt-5 border border-[var(--border-subtle)] rounded-sm px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-2">related markets</div>
              <div className="space-y-1.5">
                {relatedMarkets.slice(0, 5).map((rm) => (
                  <button key={rm.id} onClick={() => onSelectMarket(rm)} className="w-full text-left border border-[var(--border-subtle)] rounded-sm px-3 py-2 text-[12px] hover:bg-[var(--surface)] transition-colors">
                    <div className="text-[var(--text-secondary)] line-clamp-1">{rm.title}</div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[var(--text)]">{rm.prob !== null ? formatPct(rm.prob) : "\u2014"}</span>
                      <span className="text-[11px] text-[var(--text-faint)]">{formatVolume(rm.volume24h)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 mt-4">
            {market.commentCount > 0 && (
              <a href={`https://polymarket.com/event/${encodeURIComponent(market.slug)}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors">
                {market.commentCount} comments {"\u2192"}
              </a>
            )}
            <a href={`https://polymarket.com/event/${encodeURIComponent(market.slug)}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors">
              polymarket {"\u2192"}
            </a>
          </div>
        </div>
      )}

      {/* ============ SMART MONEY SECTION ============ */}
      {market.smartMoney && (market.smartMoney.whaleBuys > 0 || market.smartMoney.whaleSells > 0) && (
        <SmartMoneySection smartMoney={market.smartMoney} />
      )}
    </div>
  );
}

function SmartMoneySection({ smartMoney }: { smartMoney: SmartMoneyFlow }) {
  const [expanded, setExpanded] = useState(true);
  const flowColor = smartMoney.netFlow === "bullish" ? "#22c55e" : smartMoney.netFlow === "bearish" ? "#ff4444" : "var(--text-faint)";

  return (
    <div className="mt-5 border border-[var(--border-subtle)] rounded-sm px-3 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)]">smart money</span>
          <span className="smart-money-badge">$</span>
          <span className="text-[11px] font-bold uppercase" style={{ color: flowColor }}>
            {smartMoney.netFlow}
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
        >
          {expanded ? "collapse" : "expand"}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Flow stats */}
          <div className="flex gap-4 text-[11px] tabular-nums">
            <span className="text-[#22c55e]">{smartMoney.smartBuys} smart buys</span>
            <span className="text-[#ff4444]">{smartMoney.smartSells} smart sells</span>
            <span className="text-[var(--text-dim)]">{smartMoney.whaleBuys} whale buys</span>
            <span className="text-[var(--text-dim)]">{smartMoney.whaleSells} whale sells</span>
          </div>

          {/* Top wallets */}
          {smartMoney.topWallets.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-1.5">top wallets</div>
              <div className="space-y-1">
                {smartMoney.topWallets.map((w, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="text-[var(--text-muted)] truncate w-24">
                      {w.username || `${w.address.slice(0, 6)}...${w.address.slice(-4)}`}
                    </span>
                    <span className={w.side === "BUY" ? "text-[#22c55e]" : "text-[#ff4444]"}>
                      {w.side}
                    </span>
                    <span className="text-[var(--text-dim)] tabular-nums">
                      ${formatVolume(w.size)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent trades */}
          {smartMoney.recentTrades.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-1.5">recent trades</div>
              <div className="space-y-1">
                {smartMoney.recentTrades.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="text-[var(--text-faint)] tabular-nums w-8 shrink-0">
                      {(() => {
                        const diff = Date.now() - new Date(t.timestamp).getTime();
                        const mins = Math.floor(diff / 60000);
                        if (mins < 60) return `${mins}m`;
                        return `${Math.floor(mins / 60)}h`;
                      })()}
                    </span>
                    <span className="text-[var(--text-muted)] truncate w-16 shrink-0">
                      {t.username || `${t.wallet.slice(0, 6)}...`}
                    </span>
                    <span className={`font-bold shrink-0 ${t.side === "BUY" ? "text-[#22c55e]" : "text-[#ff4444]"}`}>
                      {t.side}
                    </span>
                    <span className="text-[var(--text-dim)] tabular-nums">
                      ${formatVolume(t.usdcSize || t.size)}
                    </span>
                    {t.isSmartWallet && <span className="smart-money-badge">$</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResolutionBanner({ markets }: { markets: ProcessedMarket["markets"] }) {
  const resolved: { question: string; winner: string }[] = [];
  for (const m of markets) {
    try {
      const raw = m.outcomePrices
        ? Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices)
        : null;
      if (!raw) continue;
      const prices = raw.map((p: string) => parseFloat(p));
      let labels: string[];
      if (Array.isArray(m.outcomes)) labels = m.outcomes;
      else if (typeof m.outcomes === "string") {
        try { labels = JSON.parse(m.outcomes); } catch { labels = []; }
      } else {
        labels = prices.length === 2 ? ["Yes", "No"] : [];
      }
      const winIdx = prices.findIndex((p: number) => p >= 0.99);
      if (winIdx >= 0 && labels[winIdx]) {
        resolved.push({ question: m.question || "", winner: labels[winIdx] });
      }
    } catch { /* skip */ }
  }
  if (resolved.length === 0) return null;
  return (
    <div className="px-3 py-2 border border-[#22c55e]/20 bg-[#22c55e]/5 rounded-sm text-[11px] space-y-1">
      {resolved.map((r, i) => (
        <div key={i}>
          <span className="uppercase tracking-[0.1em] text-[var(--text-faint)]">resolved: </span>
          <span className="text-[#22c55e] font-bold">{r.winner}</span>
          {r.question && <span className="text-[var(--text-dim)] ml-1">({r.question})</span>}
        </div>
      ))}
    </div>
  );
}
