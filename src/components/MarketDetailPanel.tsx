"use client";

import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import dynamic from "next/dynamic";
import { ProcessedMarket, PolymarketMarket, SmartMoneyFlow } from "@/types";
import { CATEGORY_COLORS } from "@/lib/categories";
import { formatVolume, formatPct, formatChange } from "@/lib/format";
import { makeAbbrev, extractLabels } from "@/lib/marketLabels";
import ChartPanel from "./ChartPanel";

const OrderForm = dynamic(() => import("./OrderForm"), { ssr: false });

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

function MarketDetailPanelInner({
  market,
  relatedMarkets,
  onBack,
  onSelectMarket,
  onTagClick,
}: MarketDetailPanelProps) {
  const color = CATEGORY_COLORS[market.category] || CATEGORY_COLORS.Other;
  const chg = formatChange(market.change);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  // -1 = none expanded; 0..n = which multi-binary row has its trade strip open
  const [selectedOrderOutcomeIdx, setSelectedOrderOutcomeIdx] = useState(0);
  // Reset everything when market changes
  useEffect(() => {
    setAiSummary(null);
    setSelectedOrderOutcomeIdx(0);
  }, [market.id]);

  const fetchAiSummary = useCallback(async () => {
    if (aiLoading) return;
    setAiLoading(true);
    try {
      // Fetch enrichment data in parallel (non-critical, wrapped in try/catch)
      let newsData: Array<{ title: string; summary?: string | null }> | undefined;
      let smartMoneyData: { netFlow: "bullish" | "bearish" | "neutral"; smartBuys: number; smartSells: number; whaleBuys: number; whaleSells: number } | undefined;
      let priceHistory: string | undefined;

      try {
        const [newsRes] = await Promise.all([
          fetch(`/api/news?marketId=${encodeURIComponent(market.id)}`).then(r => r.ok ? r.json() : []).catch(() => []),
        ]);
        if (Array.isArray(newsRes) && newsRes.length > 0) {
          newsData = newsRes.slice(0, 5).map((n: { title: string; summary?: string | null }) => ({ title: n.title, summary: n.summary }));
        }
      } catch { /* non-critical */ }

      // Extract smart money data if available
      if (market.smartMoney) {
        const sm = market.smartMoney;
        smartMoneyData = {
          netFlow: sm.netFlow,
          smartBuys: sm.smartBuys,
          smartSells: sm.smartSells,
          whaleBuys: sm.whaleBuys,
          whaleSells: sm.whaleSells,
        };
      }

      // Compute price history from change
      if (market.change !== null) {
        const dir = market.change > 0 ? "up" : market.change < 0 ? "down" : "flat";
        priceHistory = `${dir} ${Math.abs(market.change * 100).toFixed(1)}% in 24h`;
      }

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
            news: newsData,
            smartMoney: smartMoneyData,
            priceHistory,
          },
        }),
      });
      const data = await res.json();
      if (data.summary) {
        setAiSummary(data.summary);
      } else if (data.error) {
        setAiSummary(`Error: ${data.error}`);
      }
    } catch {
      setAiSummary("Failed to generate summary");
    }
    setAiLoading(false);
  }, [market, relatedMarkets, aiLoading]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(Math.floor(e.contentRect.width));
    });
    obs.observe(containerRef.current);
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
    return Math.max(48, Math.min(72, maxLen * 6.5 + 4));
  }, [parsedOutcomes]);

  // If labels are very long, use a stacked layout (label above bar) instead of inline
  const stackedLayout = useMemo(() => {
    if (parsedOutcomes.length === 0) return false;
    const maxLen = Math.max(...parsedOutcomes.map(o => o.abbr.length));
    return maxLen > 20;
  }, [parsedOutcomes]);

  // --- Multi-binary outcomes: rows with inline trade strips ---
  const multiBinaryContent = multiBinary && (
    <div>
      {parsedOutcomes.map(({ m, idx, yesPrice, entity, abbr, mChg, isWinner }, i) => {
        const pct = yesPrice * 100;
        const barColor = "#22c55e";
        const isOpen = i === Math.min(selectedOrderOutcomeIdx, parsedOutcomes.length - 1);
        const ids: string[] = m.clobTokenIds
          ? Array.isArray(m.clobTokenIds) ? m.clobTokenIds as string[]
            : (() => { try { return JSON.parse(m.clobTokenIds as unknown as string) as string[]; } catch { return []; } })()
          : [];
        const tokenId = ids[0] ? String(ids[0]) : (m.id ?? "");
        return (
          <div key={m.id || idx} className={`border-b border-[var(--border-subtle)] last:border-0 ${isOpen ? "bg-[#22c55e]/[0.03]" : ""}`}>
            {/* Outcome row — click to toggle trade strip */}
            <div
              onClick={() => setSelectedOrderOutcomeIdx(isOpen ? -1 : i)}
              className={`group flex items-center gap-1.5 py-[3px] cursor-pointer transition-colors ${
                isOpen
                  ? "border-l-2 border-l-[#22c55e]/60 pl-[4px] pr-1.5"
                  : "hover:bg-[var(--surface)] border-l-2 border-l-transparent px-1.5"
              }`}
              title={entity}
            >
              <span
                className={`text-[10px] shrink-0 truncate ${isWinner ? "text-[#22c55e] font-bold" : isOpen ? "text-[var(--text)]" : "text-[var(--text-secondary)]"}`}
                style={{ width: labelColWidth }}
              >
                {abbr}
              </span>
              <div className="flex-1 h-3 bg-[var(--bg)] rounded-sm relative overflow-hidden">
                <div
                  className="h-full rounded-sm transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(pct, 1)}%`, background: `linear-gradient(90deg, ${barColor}aa, ${barColor}44)` }}
                />
              </div>
              <span className={`text-[10px] w-10 text-right tabular-nums shrink-0 ${isWinner ? "text-[#22c55e] font-bold" : isOpen ? "text-[#22c55e]" : "text-[var(--text-dim)]"}`}>
                {pct.toFixed(1)}%
              </span>
              <span className={`text-[9px] w-10 text-right tabular-nums shrink-0 ${mChg.cls === "up" ? "text-[#22c55e]" : mChg.cls === "down" ? "text-[#ff4444]" : "text-[var(--text-faint)]"}`}>
                {mChg.text}
              </span>
              {/* trade indicator */}
              <span className={`text-[8px] px-1 shrink-0 transition-colors ${
                isOpen
                  ? "text-[#22c55e]"
                  : "text-transparent group-hover:text-[var(--text-faint)]"
              }`}>
                {isOpen ? "▾" : "▸"}
              </span>
            </div>
            {/* Inline compact trade strip */}
            {isOpen && tokenId && (
              <div className="px-2 py-1.5 border-t border-[#22c55e]/10">
                <OrderForm
                  key={tokenId}
                  tokenId={tokenId}
                  currentPrice={yesPrice}
                  outcomeName={abbr}
                  negRisk={!!market.negRisk}
                  defaultSide="BUY"
                  compact
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // --- Regular outcomes: card-based display ---
  const regularContent = !multiBinary && hasOutcomes && (
    <div className="space-y-1.5">
      {regularCards.map(({ m, i, prices, outcomeLabels, mChg, winnerIdx }) => {
        let cardTitle = m.groupItemTitle || m.question || "\u2014";
        if (!m.groupItemTitle && m.question && market.title) {
          const q = m.question;
          const prefix = market.title;
          if (q === prefix) {
            cardTitle = q;
          } else if (q.startsWith(prefix)) {
            const suffix = q.slice(prefix.length).replace(/^[\s\-:·]+/, "").trim();
            if (suffix) cardTitle = suffix;
          }
        }
        const isSimpleYesNo = outcomeLabels.length === 2 && outcomeLabels[0] === "Yes" && outcomeLabels[1] === "No"
          && (!m.question || m.question === market.title || cardTitle === market.title);
        const maxLabelLen = Math.max(...outcomeLabels.map(l => l.length), 0);
        const regLabelW = isSimpleYesNo ? 24 : Math.max(28, Math.min(72, maxLabelLen * 6.5 + 4));
        return (
        <div key={m.id || i} className={`border border-[var(--border-subtle)] rounded-sm px-2 ${isSimpleYesNo ? "py-1.5" : "py-2"} text-[11px]`}>
          {!isSimpleYesNo && (
            <div className="text-[var(--text)] font-bold text-[11px] line-clamp-1 mb-1" title={m.question || ""}>
              {cardTitle}
            </div>
          )}
          {prices.length > 0 && outcomeLabels.length > 0 ? (
            <div className="space-y-[2px]">
              {outcomeLabels.map((label, j) => {
                const pct = prices[j] != null ? prices[j] * 100 : 0;
                const isW = winnerIdx === j;
                const isYes = label === "Yes";
                const isNo = label === "No";
                const barColor = isW ? "#22c55e" : isYes ? "#22c55e" : isNo ? "#ff4444" : j === 0 ? color : "#6b7280";
                const labelColor = isW ? "#22c55e" : isYes ? "#22c55e" : isNo ? "#ff4444" : "var(--text-dim)";
                return (
                  <div key={j} className="flex items-center gap-1.5">
                    <span className="text-[10px] shrink-0 truncate font-medium" style={{ color: labelColor, width: regLabelW }} title={label}>
                      {label}
                    </span>
                    <div className="flex-1 h-3 bg-[var(--bg)] rounded-sm relative overflow-hidden">
                      <div
                        className="h-full rounded-sm transition-all duration-500 ease-out"
                        style={{ width: `${Math.max(pct, 2)}%`, background: `linear-gradient(90deg, ${barColor}99, ${barColor}44)` }}
                      />
                    </div>
                    <span className="text-[10px] w-10 text-right tabular-nums shrink-0" style={{ color: labelColor }}>
                      {pct.toFixed(1)}%
                    </span>
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
          {/* Per-outcome inline trade strips */}
          {prices.length > 0 && (() => {
            const allIds: string[] = m.clobTokenIds
              ? Array.isArray(m.clobTokenIds) ? m.clobTokenIds as string[]
                : (() => { try { return JSON.parse(m.clobTokenIds as unknown as string) as string[]; } catch { return []; } })()
              : [];
            if (allIds.length === 0) return (
              <div className="mt-1 pt-1 border-t border-[var(--border-subtle)] flex justify-end">
                <a href={`https://polymarket.com/event/${encodeURIComponent(market.slug)}?via=pw`} target="_blank" rel="noopener noreferrer" className="text-[9px] text-[var(--text-ghost)] hover:text-[var(--text-dim)] transition-colors">
                  trade {"\u2192"}
                </a>
              </div>
            );
            return (
              <div className="mt-1.5 space-y-1">
                {outcomeLabels.slice(0, allIds.length).map((label, j) => {
                  const p = prices[j] ?? 0;
                  const isYes = label === "Yes";
                  const isNo = label === "No";
                  const accentColor = isYes ? "#22c55e" : isNo ? "#ff4444" : "#a78bfa";
                  return (
                    <div key={j} className="flex items-center gap-2 pt-1 border-t border-[var(--border-subtle)]">
                      <span
                        className="text-[9px] shrink-0 font-medium tabular-nums"
                        style={{ color: accentColor, minWidth: 28 }}
                      >
                        {label}
                      </span>
                      <span className="text-[9px] tabular-nums shrink-0" style={{ color: accentColor }}>
                        {(p * 100).toFixed(0)}¢
                      </span>
                      <div className="flex-1 min-w-0">
                        <OrderForm
                          key={String(allIds[j])}
                          tokenId={String(allIds[j])}
                          currentPrice={p}
                          outcomeName={label}
                          negRisk={!!market.negRisk}
                          defaultSide="BUY"
                          compact
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <div className="flex items-center gap-2 mt-1 pt-1 border-t border-[var(--border-subtle)] text-[9px] text-[var(--text-faint)]">
            {m.volume && <span>{formatVolume(parseFloat(String(m.volume)))}</span>}
            {m.liquidity && <span>liq {formatVolume(parseFloat(String(m.liquidity)))}</span>}
            {mChg.text !== "\u2014" && <span className={mChg.cls === "up" ? "text-[#22c55e]" : mChg.cls === "down" ? "text-[#ff4444]" : ""}>{mChg.text}</span>}
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
        <div className={`min-w-0 flex flex-col gap-2 ${isWide && hasOutcomes ? "flex-1" : ""}`}>
          {/* Row 1: title + AI button */}
          <div className="flex items-start gap-2">
            {market.image ? (
              <img src={market.image} alt="" className="w-7 h-7 rounded object-cover shrink-0 border border-[var(--border)] mt-0.5" />
            ) : (
              <div className="w-7 h-7 rounded shrink-0 flex items-center justify-center text-[12px] font-bold border border-[var(--border)] mt-0.5" style={{ background: `${color}18`, color }}>
                {market.title.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[11px] text-[var(--text)] leading-[1.4] line-clamp-2" title={market.title}>{market.title}</h2>
                <div className="relative shrink-0 ai-summary-trigger">
                  <button
                    onClick={fetchAiSummary}
                    disabled={aiLoading}
                    className={`shrink-0 transition-colors disabled:opacity-50 ${aiSummary ? "text-[#f59e0b]" : "text-[var(--text-faint)] hover:text-[#f59e0b]"}`}
                    title={aiSummary ? undefined : "Generate AI Summary"}
                  >
                    {aiLoading ? (
                      <span className="inline-block w-3 h-3 border border-[#f59e0b] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span className="text-[13px]">{"\u2728"}</span>
                    )}
                  </button>
                  {aiSummary && (
                    <div className="ai-summary-tooltip">
                      <p className="text-[11px] text-[var(--text-dim)] leading-[1.5]">{aiSummary}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: prob + change + meta tags — single dense line */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[20px] text-[var(--text)] font-bold tracking-tight leading-none tabular-nums">
              {market.prob !== null ? formatPct(market.prob) : "\u2014"}
            </span>
            {topOptionLabel && (
              <span className="text-[11px] text-[var(--text-muted)] max-w-[120px] truncate" title={topOptionLabel}>
                {topOptionLabel}
              </span>
            )}
            <span className={`text-[11px] tabular-nums ${chg.cls === "up" ? "text-[#22c55e]" : chg.cls === "down" ? "text-[#ff4444]" : "text-[var(--text-faint)]"}`}>
              {chg.text}
            </span>
            <div className="flex items-center gap-1.5 ml-auto text-[10px] text-[var(--text-faint)]">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
              <span>{market.category.toLowerCase()}</span>
              {market.location && <><span>{"\u00B7"}</span><span>{market.location.toLowerCase()}</span></>}
              {(market.closed || (market.endDate && new Date(market.endDate).getTime() < Date.now())) ? (
                <span className="text-[#ff4444]">closed</span>
              ) : market.active ? (
                <span className="text-[#22c55e]">active</span>
              ) : null}
              {market.endDate && <><span>{"\u00B7"}</span><span>{formatEndDate(market.endDate)}</span></>}
            </div>
          </div>

          {/* Row 3: vol / 24h / liq — compact stats */}
          <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)] tabular-nums">
            <span>Vol <span className="text-[var(--text-dim)]">{formatVolume(market.volume)}</span></span>
            <span>24h <span className="text-[var(--text-dim)]">{formatVolume(market.volume24h)}</span></span>
            <span>Liq <span className="text-[var(--text-dim)]">{formatVolume(market.liquidity)}</span></span>
          </div>


          {market.closed && hasOutcomes && <ResolutionBanner markets={activeMarketsList} />}

          {/* Chart — reuse Price Chart panel */}
          <div className="flex-1 min-h-0 rounded-sm overflow-hidden border border-[var(--border)]" style={{ minHeight: 230, maxHeight: 270 }}>
            <ChartPanel selectedMarket={market} lineOnly />
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
                    <ResolutionMonitorBadge eventId={market.id} />
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
                    {new Date(market.createdAt!).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
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
              <a href={`https://polymarket.com/event/${encodeURIComponent(market.slug)}?via=pw`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors">
                {market.commentCount} comments {"\u2192"}
              </a>
            )}
            <a href={`https://polymarket.com/event/${encodeURIComponent(market.slug)}?via=pw`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors">
              polymarket {"\u2192"}
            </a>
            <CopyLinkButton marketId={market.id} />
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

function CopyLinkButton({ marketId }: { marketId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("m", marketId);
          navigator.clipboard.writeText(url.toString());
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* ignore */ }
      }}
      className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors"
    >
      {copied ? "copied!" : "copy link"}
    </button>
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

export default memo(MarketDetailPanelInner, (prev, next) => {
  if (prev.market.id !== next.market.id) return false;
  if (prev.market.prob !== next.market.prob) return false;
  if (prev.market.change !== next.market.change) return false;
  if (prev.market.volume !== next.market.volume) return false;
  if (prev.relatedMarkets !== next.relatedMarkets) return false;
  return true;
});

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

function ResolutionMonitorBadge({ eventId }: { eventId: string }) {
  const [status, setStatus] = useState<{ sourceType: string; lastCheckedAt: string | null } | null>(null);

  useEffect(() => {
    fetch(`/api/resolution-alerts?marketId=${eventId}`)
      .then((r) => r.json())
      .then((data) => { if (data.monitor) setStatus(data.monitor); })
      .catch(() => {});
  }, [eventId]);

  if (!status) return null;

  const isMonitored = ["known_feed", "price_feed", "sports_feed"].includes(status.sourceType);
  if (isMonitored) {
    const ago = status.lastCheckedAt
      ? `${Math.round((Date.now() - new Date(status.lastCheckedAt).getTime()) / 60_000)}m ago`
      : "pending";
    const label = status.sourceType === "price_feed" ? "price" : status.sourceType === "sports_feed" ? "sports" : "rss";
    return (
      <span className="ml-2 text-[10px] text-[#22c55e]/70">
        {label} monitored · {ago}
      </span>
    );
  }

  return (
    <span className="ml-2 text-[10px] text-[var(--text-ghost)]">
      not monitorable
    </span>
  );
}
