"use client";

import { useState, useRef, useCallback, useMemo, useEffect, lazy, Suspense, memo } from "react";
import { createPortal } from "react-dom";
import { ProcessedMarket, PolymarketMarket } from "@/types";
import { CATEGORY_COLORS } from "@/lib/categories";
import { IMPACT_COLORS } from "@/lib/impact";
import { formatVolume, formatPct, formatChange } from "@/lib/format";
import { useI18n } from "@/i18n";

const MarketPreview = lazy(() => import("./MarketPreview"));

const NEW_THRESHOLD_MS = 6 * 60 * 60 * 1000;

function isNew(market: ProcessedMarket): boolean {
  if (!market.createdAt) return false;
  const age = Date.now() - new Date(market.createdAt).getTime();
  return age < NEW_THRESHOLD_MS;
}

function formatEndDate(d: string | null | undefined): { label: string; urgency: "critical" | "soon" | null } | null {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 0) return { label: "ended", urgency: null };
  if (diffHours < 24) return { label: diffHours < 1 ? "<1h" : `${Math.floor(diffHours)}h`, urgency: "critical" };
  const days = Math.ceil(diffHours / 24);
  if (days <= 7) return { label: days === 1 ? "1d" : `${days}d`, urgency: "soon" };
  if (days < 30) return { label: `${days}d`, urgency: null };
  if (days < 365) return { label: `${Math.floor(days / 30)}mo`, urgency: null };
  return { label: `${(days / 365).toFixed(1)}y`, urgency: null };
}

/** Get the top option's label and price for multi-outcome markets */
function getTopOption(markets: PolymarketMarket[]): { label: string; prob: number } | null {
  if (!markets || markets.length < 2) return null;

  let best: { label: string; prob: number } | null = null;
  for (const m of markets) {
    if (m.active === false) continue;
    let yesPrice = 0;
    try {
      const raw = m.outcomePrices
        ? Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices)
        : null;
      if (raw) yesPrice = parseFloat(raw[0]);
    } catch { /* skip */ }
    if (isNaN(yesPrice)) continue;
    const label = m.groupItemTitle || m.question || "";
    if (!best || yesPrice > best.prob) {
      best = { label, prob: yesPrice };
    }
  }
  return best;
}

const POPUP_W = 480;
const POPUP_MAX_H = 520;
const POPUP_GAP = 8;

interface MarketCardProps {
  market: ProcessedMarket;
  showChange?: boolean;
  selected?: boolean;
  onClick?: () => void;
  isWatched?: boolean;
  onToggleWatch?: () => void;
  onLocationHover?: (location: string, rect: DOMRect) => void;
  onLocationLeave?: () => void;
  onTrade?: (state: import("./TradeModal").TradeModalState) => void;
}

function MarketCardInner({
  market,
  showChange = false,
  selected = false,
  onClick,
  isWatched,
  onToggleWatch,
  onLocationHover,
  onLocationLeave,
  onTrade,
}: MarketCardProps) {
  const [renderNow] = useState(() => Date.now());
  const color = CATEGORY_COLORS[market.category];
  const chg = formatChange(market.change);
  const marketIsNew = isNew(market);
  const endLabel = formatEndDate(market.endDate);
  const activeCount = useMemo(
    () => (market.markets || []).filter(m => m.active !== false).length,
    [market.markets]
  );

  const { t } = useI18n();
  const topOption = useMemo(() => getTopOption(market.markets), [market.markets]);

  // Hover popup state
  const [showPopup, setShowPopup] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const computePosition = useCallback(() => {
    const el = cardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer left of card; if not enough space, go right
    let left: number;
    if (rect.left >= POPUP_W + POPUP_GAP) {
      left = rect.left - POPUP_W - POPUP_GAP;
    } else {
      left = rect.right + POPUP_GAP;
    }
    // Clamp horizontal
    left = Math.max(4, Math.min(left, vw - POPUP_W - 4));

    // Align top with card, clamp vertically
    let top = rect.top;
    top = Math.max(4, Math.min(top, vh - POPUP_MAX_H - 4));

    return { top, left };
  }, []);

  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (selected) return;
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    hoverTimer.current = setTimeout(() => {
      const pos = computePosition();
      if (pos) {
        setPopupPos(pos);
        setShowPopup(true);
      }
    }, 1000);
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    // Delay dismiss so cursor can reach the popup
    dismissTimer.current = setTimeout(() => setShowPopup(false), 300);
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      onClick={() => { setShowPopup(false); onClick?.(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setShowPopup(false);
          onClick?.();
        }
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="border border-[var(--border-subtle)] px-2.5 py-1.5 mb-1 cursor-pointer hover:bg-[var(--surface-hover)] transition-colors focus:outline-none font-mono"
      style={{ borderLeft: `2px solid ${color}` }}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] mb-1">
        {market.impactLevel && market.impactLevel !== "info" && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: IMPACT_COLORS[market.impactLevel] }}
            title={`Impact: ${market.impactScore}`}
          />
        )}
        <span
          className={`truncate${onLocationHover ? " cursor-default" : ""}`}
          onMouseEnter={onLocationHover ? (e) => onLocationHover((market.location || market.category), (e.currentTarget as HTMLElement).getBoundingClientRect()) : undefined}
          onMouseLeave={onLocationLeave}
        >{(market.location || market.category).toLowerCase()}</span>
        {endLabel && (
          <span
            className="shrink-0"
            style={{
              color: endLabel.urgency === "critical"
                ? "#ff4444"
                : endLabel.urgency === "soon"
                ? "#f59e0b"
                : "var(--text-faint)",
            }}
          >{"\u00B7"} {endLabel.label}</span>
        )}
        {activeCount > 1 && (
          <span className="text-[var(--text-faint)] shrink-0">{"\u00B7"} {activeCount} outcomes</span>
        )}
        {/* Right-aligned badges + star — use a single ml-auto wrapper */}
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          {market.anomaly?.isAnomaly && (
            <span
              className="text-[10px] px-1 py-px uppercase tracking-wider leading-none font-bold"
              style={{ color: "#f59e0b", background: "rgba(245,158,11,0.15)" }}
              title={`Volume spike: ${market.anomaly.zScore?.toFixed(1)}σ`}
            >
              spike
            </span>
          )}
          {marketIsNew && (
            <span className="text-[10px] text-[var(--bg)] bg-[#22c55e] px-1 py-px uppercase tracking-wider leading-none font-bold">
              new
            </span>
          )}
          {(market.closed || (market.endDate && new Date(market.endDate).getTime() < renderNow)) && (
            <span className="text-[10px] text-[#ff4444] border border-[#ff4444]/30 px-1 py-px uppercase">
              closed
            </span>
          )}
          {onToggleWatch && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleWatch(); }}
              className="shrink-0 star-btn"
              title={isWatched ? "Remove from watchlist" : "Add to watchlist"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={isWatched ? "#f59e0b" : "none"} stroke={isWatched ? "#f59e0b" : "var(--text-ghost)"} strokeWidth="2" strokeLinejoin="round">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
              </svg>
            </button>
          )}
        </span>
      </div>
      <div className="text-[12px] text-[var(--text-secondary)] leading-[1.35] mb-1 line-clamp-2">
        {market.title}
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[var(--text)]">
            {market.prob !== null ? formatPct(market.prob) : "\u2014"}
          </span>
          {market.smartMoney && market.smartMoney.netFlow !== "neutral" && (
            <span
              className="text-[9px] font-bold px-0.5 leading-none shrink-0"
              style={market.smartMoney.netFlow === "bullish"
                ? { color: "#22c55e", background: "rgba(34,197,94,0.12)" }
                : { color: "#ff4444", background: "rgba(255,68,68,0.12)" }
              }
              title={`${market.smartMoney.smartBuys} ${t("detail.smartBuys")}, ${market.smartMoney.whaleBuys + market.smartMoney.whaleSells} ${t("panels.whaleTrades").toLowerCase()}`}
            >
              {market.smartMoney.netFlow === "bullish" ? "↑$" : "↓$"}
            </span>
          )}
          {topOption && topOption.label && (
            <span className="text-[10px] text-[var(--text-muted)] truncate max-w-[120px]" title={topOption.label}>
              {topOption.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {showChange && (
            <span
              className={`text-[11px] ${
                chg.cls === "up"
                  ? "text-[#22c55e]"
                  : chg.cls === "down"
                  ? "text-[#ff4444]"
                  : "text-[var(--text-ghost)]"
              }`}
            >
              {chg.text}
            </span>
          )}
          <span className="text-[11px] text-[var(--text-ghost)]">
            {market.volume24h ? `vol ${formatVolume(market.volume24h)} 24h` : `vol ${formatVolume(market.volume)}`}
          </span>
        </div>
      </div>

      {/* Hover detail popup — rendered via portal to escape overflow clipping */}
      {showPopup && popupPos && createPortal(
        <div
          className="fixed z-[9999] bg-[var(--bg)] border border-[var(--border)] rounded-md overflow-y-auto"
          style={{
            top: popupPos.top,
            left: popupPos.left,
            width: POPUP_W,
            maxHeight: POPUP_MAX_H,
            padding: "12px 14px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
          }}
          onMouseEnter={() => {
            // Cancel pending dismiss when mouse enters popup
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
            if (dismissTimer.current) clearTimeout(dismissTimer.current);
          }}
          onMouseLeave={handleMouseLeave}
        >
          <Suspense fallback={<div className="text-[12px] text-[var(--text-faint)] font-mono py-4">loading...</div>}>
            <MarketPreview market={market} onTrade={onTrade} />
          </Suspense>
        </div>,
        document.body
      )}
    </div>
  );
}

const MarketCard = memo(MarketCardInner, (prev, next) => {
  // Re-render only when data that affects the visible card changes
  if (prev.market.id !== next.market.id) return false;
  if (prev.market.prob !== next.market.prob) return false;
  if (prev.market.change !== next.market.change) return false;
  if (prev.market.volume24h !== next.market.volume24h) return false;
  if (prev.isWatched !== next.isWatched) return false;
  if (prev.onTrade !== next.onTrade) return false;
  return true;
});

export default MarketCard;
