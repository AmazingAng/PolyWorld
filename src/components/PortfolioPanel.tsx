"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { fetchTraderPositions, fetchTraderValue, type TraderPosition } from "@/lib/smartMoney";
import { formatVolume } from "@/lib/format";
import type { ProcessedMarket } from "@/types";
import { useWalletStore } from "@/stores/walletStore";

const PORTFOLIO_WALLET_KEY = "pw:portfolioWallet";

function readSavedWallet(): string {
  if (typeof window === "undefined") return "";
  try { return localStorage.getItem(PORTFOLIO_WALLET_KEY) || ""; } catch { return ""; }
}

function saveWallet(addr: string) {
  try { localStorage.setItem(PORTFOLIO_WALLET_KEY, addr); } catch { /* ignore */ }
}

interface PortfolioPanelProps {
  markets: ProcessedMarket[];
  onSelectMarket?: (slug: string) => void;
}

function timeUntil(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const h = Math.floor(diff / 3_600_000);
  if (h < 24) return `${h}h`;
  const d = Math.floor(diff / 86_400_000);
  return `${d}d`;
}

function expiryColor(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "#888";
  if (diff < 24 * 3_600_000) return "#ff4444";
  if (diff < 7 * 86_400_000) return "#f59e0b";
  return null;
}

interface PositionWithMarket {
  position: TraderPosition;
  market: ProcessedMarket | undefined;
}

export default function PortfolioPanel({ markets, onSelectMarket }: PortfolioPanelProps) {
  const connectedAddress = useWalletStore((s) => s.address);
  // Start with "" on both server and client to avoid hydration mismatch,
  // then load from localStorage + connected wallet in a single effect.
  const [savedWallet, setSavedWalletState] = useState<string>("");
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    const stored = readSavedWallet();
    if (stored) {
      // Respect manually saved wallet — don't overwrite with connected address
      setSavedWalletState(stored);
    } else if (connectedAddress) {
      // No saved wallet yet: use connected address as default (don't persist yet)
      setSavedWalletState(connectedAddress);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // Do NOT auto-sync on wallet connect — user may be tracking a different wallet
  const [positions, setPositions] = useState<TraderPosition[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const cancelRef = useRef(false);

  // Match positions to markets by conditionId → marketId, or by title fallback
  const enriched = useMemo<PositionWithMarket[]>(() => {
    return positions.map((p) => {
      // Try matching via conditionId against sub-market IDs first
      let market = markets.find((m) =>
        m.markets.some((sm) => sm.id === p.conditionId)
      );
      // Fallback: match by title substring
      if (!market && p.title) {
        const titleLower = p.title.toLowerCase();
        market = markets.find((m) => m.title.toLowerCase() === titleLower);
        if (!market) {
          market = markets.find((m) =>
            m.title.toLowerCase().includes(titleLower.slice(0, 30)) ||
            titleLower.includes(m.title.toLowerCase().slice(0, 30))
          );
        }
      }
      return { position: p, market };
    });
  }, [positions, markets]);

  const openPositions = useMemo(() => enriched.filter((e) => !e.position.redeemed), [enriched]);
  const closedPositions = useMemo(() => enriched.filter((e) => e.position.redeemed), [enriched]);
  const totalPnl = useMemo(
    () => openPositions.reduce((s, e) => s + e.position.cashPnl, 0),
    [openPositions]
  );

  const load = useCallback(async (wallet: string) => {
    if (!wallet) return;
    cancelRef.current = false;
    setLoading(true);
    setError(null);
    try {
      const [pos, val] = await Promise.all([
        fetchTraderPositions(wallet),
        fetchTraderValue(wallet),
      ]);
      if (cancelRef.current) return;
      setPositions(pos);
      setTotalValue(val);
    } catch {
      if (!cancelRef.current) setError("Failed to load positions");
    } finally {
      if (!cancelRef.current) setLoading(false);
    }
  }, []);

  // Load on wallet change + auto-refresh every 5 min
  useEffect(() => {
    if (!savedWallet) { setPositions([]); setTotalValue(0); return; }
    load(savedWallet);
    const iv = setInterval(() => load(savedWallet), 300_000);
    return () => { cancelRef.current = true; clearInterval(iv); };
  }, [savedWallet, load]);

  const setSavedWallet = useCallback((addr: string) => {
    setSavedWalletState(addr);
    saveWallet(addr);
  }, []);

  const handleSubmit = useCallback(() => {
    const addr = inputValue.trim();
    if (/^0x[a-fA-F0-9]{40}$/i.test(addr)) {
      setSavedWallet(addr);
      setInputValue("");
    }
  }, [inputValue, setSavedWallet]);

  const handleClear = useCallback(() => {
    setSavedWallet("");
    setPositions([]);
    setTotalValue(0);
  }, [setSavedWallet]);

  return (
    <div className="flex flex-col h-full font-mono text-[11px]">
      {/* Wallet input bar */}
      <div className="flex items-center gap-1 px-1.5 py-1 border-b border-[var(--border)]">
        {savedWallet ? (
          <>
            <span className="text-[10px] text-[var(--text-dim)] truncate flex-1" title={savedWallet}>
              {savedWallet.slice(0, 6)}…{savedWallet.slice(-4)}
            </span>
            <button
              onClick={() => load(savedWallet)}
              className="text-[9px] text-[var(--text-faint)] hover:text-[var(--text)] transition-colors px-1"
              title="Refresh"
            >
              ↺
            </button>
            <button
              onClick={handleClear}
              className="text-[9px] text-[var(--text-ghost)] hover:text-[var(--text)] transition-colors"
              title="Clear wallet"
            >
              ×
            </button>
          </>
        ) : (
          <>
            <input
              className="flex-1 bg-transparent border border-[var(--border)] rounded-sm px-1.5 py-0 text-[10px] text-[var(--text)] placeholder:text-[var(--text-ghost)] leading-[18px] min-w-0"
              placeholder="0x… wallet to track"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
            {connectedAddress && connectedAddress.toLowerCase() !== inputValue.toLowerCase() && (
              <button
                onClick={() => setInputValue(connectedAddress)}
                className="px-1.5 py-0 border border-[var(--border)] rounded-sm text-[9px] text-[var(--text-ghost)] hover:text-[var(--text-dim)] transition-colors leading-[18px] shrink-0"
                title="Use connected wallet"
              >
                mine
              </button>
            )}
            <button
              onClick={handleSubmit}
              className="px-1.5 py-0 border border-[var(--border)] rounded-sm text-[9px] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors leading-[18px] shrink-0"
            >
              GO
            </button>
          </>
        )}
      </div>

      {/* Body */}
      {!savedWallet ? (
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-center px-4 leading-relaxed">
          Enter your wallet address to track your positions and PnL
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-[var(--text-muted)]">
          <div className="w-4 h-4 border border-[#2a2a2a] border-t-[#a0a0a0] rounded-full animate-spin" />
          loading…
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-[#ff4444]">{error}</div>
      ) : (
        <>
          {/* Stats bar */}
          <div className="flex items-center gap-3 px-2 py-1.5 border-b border-[var(--border)] text-[10px] tabular-nums">
            <div>
              <span className="text-[var(--text-muted)]">VALUE </span>
              <span className="text-[var(--text)]">{formatVolume(totalValue)}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">UNREAL PNL </span>
              <span style={{ color: totalPnl >= 0 ? "#22c55e" : "#ff4444" }}>
                {totalPnl >= 0 ? "+" : ""}{formatVolume(totalPnl)}
              </span>
            </div>
            <div className="text-[var(--text-muted)]">
              {openPositions.length} open
            </div>
          </div>

          {/* Open positions */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {openPositions.length === 0 ? (
              <div className="px-2 py-4 text-center text-[var(--text-muted)]">no open positions</div>
            ) : (
              <>
                {openPositions.map((e, i) => (
                  <PositionRow
                    key={`o-${i}`}
                    item={e}
                    onSelectMarket={onSelectMarket}
                  />
                ))}
              </>
            )}

            {/* Closed positions toggle */}
            {closedPositions.length > 0 && (
              <>
                <button
                  onClick={() => setShowClosed((v) => !v)}
                  className="w-full px-2 py-1 text-[9px] text-[var(--text-faint)] uppercase tracking-wider bg-[var(--bg-panel)] hover:text-[var(--text-dim)] transition-colors text-left border-t border-[var(--border)]"
                >
                  {showClosed ? "▼" : "▶"} Closed ({closedPositions.length})
                </button>
                {showClosed && closedPositions.map((e, i) => (
                  <PositionRow
                    key={`c-${i}`}
                    item={e}
                    dimmed
                    onSelectMarket={onSelectMarket}
                  />
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PositionRow({
  item,
  dimmed,
  onSelectMarket,
}: {
  item: PositionWithMarket;
  dimmed?: boolean;
  onSelectMarket?: (slug: string) => void;
}) {
  const { position: p, market } = item;
  const expiry = market?.endDate;
  const expColor = expiryColor(expiry);
  const expLabel = timeUntil(expiry);

  // Smart money alignment badge
  const smFlow = market?.smartMoney?.netFlow;
  const isAligned =
    smFlow === "bullish" && p.outcome?.toLowerCase() === "yes" ||
    smFlow === "bearish" && p.outcome?.toLowerCase() === "no";
  const isDivergent =
    smFlow === "bullish" && p.outcome?.toLowerCase() === "no" ||
    smFlow === "bearish" && p.outcome?.toLowerCase() === "yes";

  const handleClick = useCallback(() => {
    if (market?.slug) onSelectMarket?.(market.slug);
  }, [market, onSelectMarket]);

  return (
    <div
      className="border-b border-[var(--border-subtle)] last:border-0 px-2 py-[5px]"
      style={{ opacity: dimmed ? 0.55 : 1 }}
    >
      {/* Row 1: title + smart money badge */}
      <div className="flex items-start gap-1 mb-0.5">
        <button
          className="flex-1 min-w-0 text-left text-[var(--text)] truncate hover:text-[#22c55e] transition-colors leading-tight"
          title={p.title}
          onClick={handleClick}
        >
          {p.title || p.conditionId.slice(0, 16) + "…"}
        </button>
        {isAligned && (
          <span className="text-[8px] px-0.5 rounded shrink-0" style={{ color: "#22c55e", background: "rgba(34,197,94,0.1)" }} title="Smart money aligned">
            ↑SM
          </span>
        )}
        {isDivergent && (
          <span className="text-[8px] px-0.5 rounded shrink-0" style={{ color: "#f59e0b", background: "rgba(245,158,11,0.1)" }} title="Smart money divergent">
            ⚡SM
          </span>
        )}
      </div>

      {/* Row 2: outcome / value / pnl / expiry */}
      <div className="flex items-center gap-1.5 tabular-nums">
        <span
          className="text-[9px] px-1 rounded-sm shrink-0"
          style={{
            color: p.outcome?.toLowerCase() === "yes" ? "#22c55e" : p.outcome?.toLowerCase() === "no" ? "#ff4444" : "var(--text-dim)",
            background: p.outcome?.toLowerCase() === "yes" ? "rgba(34,197,94,0.1)" : p.outcome?.toLowerCase() === "no" ? "rgba(255,68,68,0.1)" : "rgba(128,128,128,0.08)",
          }}
        >
          {p.outcome || "—"}
        </span>
        <span className="text-[var(--text)] text-[10px]">{formatVolume(p.currentValue)}</span>
        <span
          className="text-[10px]"
          style={{ color: p.cashPnl >= 0 ? "#22c55e" : "#ff4444" }}
        >
          {p.cashPnl >= 0 ? "+" : ""}{formatVolume(p.cashPnl)}
          {p.percentPnl !== 0 && (
            <span className="text-[9px] ml-0.5" style={{ opacity: 0.7 }}>
              ({p.percentPnl >= 0 ? "+" : ""}{p.percentPnl.toFixed(0)}%)
            </span>
          )}
        </span>
        {expLabel && !dimmed && (
          <span
            className="text-[9px] ml-auto shrink-0"
            style={{ color: expColor || "var(--text-ghost)" }}
            title={`Expires ${expiry}`}
          >
            {expLabel}
          </span>
        )}
      </div>
    </div>
  );
}
