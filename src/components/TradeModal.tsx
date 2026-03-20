"use client";

import { useEffect, useCallback, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useReadContract } from "wagmi";
import { polygon } from "wagmi/chains";
import { useWalletStore } from "@/stores/walletStore";
import type { SmartMoneyFlow } from "@/types";

const OrderForm = dynamic(() => import("./OrderForm"), { ssr: false });

export interface TokenInfo {
  tokenId: string;
  price: number;
  name: string;
}

export interface TradeModalState {
  tokenId: string;
  currentPrice: number;
  outcomeName: string;
  marketTitle: string;
  negRisk: boolean;
  defaultSide: "BUY" | "SELL";
  /** Both YES and NO tokens — enables in-modal switching */
  yesToken?: TokenInfo;
  noToken?: TokenInfo;
  smartMoney?: SmartMoneyFlow | null;
  /** Market stats for info bar */
  volume?: number;
  volume24h?: number;
  liquidity?: number;
  recentChange?: number | null;
}

const RECENT_ORDERS_KEY = "polyworld:recentOrders";
interface RecentOrder {
  id: string;
  side: string;
  outcome: string;
  amount: number;
  price: number;
  ts: number;
}
function loadRecentOrders(): RecentOrder[] {
  try {
    const raw = localStorage.getItem(RECENT_ORDERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentOrder[];
  } catch { return []; }
}
function saveRecentOrder(order: RecentOrder) {
  try {
    const existing = loadRecentOrders();
    const updated = [order, ...existing].slice(0, 10);
    localStorage.setItem(RECENT_ORDERS_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
}
function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}min ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ─── Mini Order Book ──────────────────────────────────────────────────────────

interface BookLevel { price: number; size: number; }
interface BookData { bids: BookLevel[]; asks: BookLevel[]; }

async function loadOrderBook(
  tokenId: string,
  signal: AbortSignal,
): Promise<BookData | null> {
  const res = await fetch(`/api/orderbook?tokenId=${encodeURIComponent(tokenId)}`, { signal });
  if (!res.ok) return null;
  return res.json() as Promise<BookData>;
}

function MiniOrderBook({ tokenId, currentPrice }: { tokenId: string; currentPrice: number }) {
  const [book, setBook] = useState<BookData | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchLatest = async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const data = await loadOrderBook(tokenId, ac.signal);
        if (!cancelled && !ac.signal.aborted) {
          setBook(data);
          setLoading(false);
        }
      } catch {
        // aborted or network error
      }
    };

    void fetchLatest();
    const iv = setInterval(() => {
      void fetchLatest();
    }, 5_000);

    return () => {
      cancelled = true;
      clearInterval(iv);
      abortRef.current?.abort();
    };
  }, [tokenId]);

  // Compute cumulative sizes for depth bars
  const ROWS = 8;
  const asks = useMemo(() => {
    if (!book?.asks?.length) return [];
    const sorted = [...book.asks].sort((a, b) => a.price - b.price).slice(0, ROWS);
    let cum = 0;
    return sorted.map(l => { cum += l.size; return { ...l, cum }; });
  }, [book]);

  const bids = useMemo(() => {
    if (!book?.bids?.length) return [];
    const sorted = [...book.bids].sort((a, b) => b.price - a.price).slice(0, ROWS);
    let cum = 0;
    return sorted.map(l => { cum += l.size; return { ...l, cum }; });
  }, [book]);

  const maxCum = Math.max(asks[asks.length - 1]?.cum ?? 0, bids[bids.length - 1]?.cum ?? 0) || 1;
  const spread = asks[0] && bids[0] ? ((asks[0].price - bids[0].price) * 100).toFixed(1) : null;

  if (loading) return (
    <div className="flex items-center justify-center h-full text-[var(--text-ghost)] text-[10px]">loading…</div>
  );
  if (!book || (!asks.length && !bids.length)) return (
    <div className="flex items-center justify-center h-full text-[var(--text-ghost)] text-[10px]">no book data</div>
  );

  return (
    <div className="flex flex-col h-full select-none">
      {/* Column headers */}
      <div className="flex items-center justify-between text-[8px] uppercase tracking-wider text-[var(--text-ghost)] px-2 pb-1 shrink-0">
        <span>price</span>
        <span>shares</span>
      </div>

      {/* Asks (lowest ask at bottom of asks section) */}
      <div className="flex-1 flex flex-col justify-end overflow-hidden">
        {asks.slice().reverse().map((l, i) => (
          <div key={i} className="relative flex items-center justify-between px-2 py-[2px] text-[10px] tabular-nums">
            <div
              className="absolute inset-y-0 right-0"
              style={{ width: `${(l.cum / maxCum) * 100}%`, background: "rgba(248,113,113,0.12)" }}
            />
            <span className="relative z-10 text-[#f87171]">{(l.price * 100).toFixed(1)}¢</span>
            <span className="relative z-10 text-[var(--text-dim)]">{l.size.toFixed(0)}</span>
          </div>
        ))}
      </div>

      {/* Spread / mid */}
      <div className="flex items-center justify-between px-2 py-1 border-y border-[var(--border-subtle)] shrink-0">
        <span className="text-[9px] text-[var(--text-ghost)]">mid</span>
        <span className="text-[10px] font-bold text-[var(--text)] tabular-nums">{(currentPrice * 100).toFixed(1)}¢</span>
        {spread && <span className="text-[9px] text-[var(--text-ghost)]">spread {spread}¢</span>}
      </div>

      {/* Bids */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {bids.map((l, i) => (
          <div key={i} className="relative flex items-center justify-between px-2 py-[2px] text-[10px] tabular-nums">
            <div
              className="absolute inset-y-0 right-0"
              style={{ width: `${(l.cum / maxCum) * 100}%`, background: "rgba(74,222,128,0.12)" }}
            />
            <span className="relative z-10 text-[#4ade80]">{(l.price * 100).toFixed(1)}¢</span>
            <span className="relative z-10 text-[var(--text-dim)]">{l.size.toFixed(0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface TradeModalProps {
  state: TradeModalState;
  onClose: () => void;
}

export default function TradeModal({ state, onClose }: TradeModalProps) {
  const modalKey = [
    state.tokenId,
    state.currentPrice,
    state.outcomeName,
    state.defaultSide,
    state.marketTitle,
  ].join(":");

  return <TradeModalContent key={modalKey} state={state} onClose={onClose} />;
}

function TradeModalContent({ state, onClose }: TradeModalProps) {
  const hasYesNo = !!(state.yesToken && state.noToken);

  const [activeTokenId, setActiveTokenId] = useState(state.tokenId);
  const [activePrice, setActivePrice] = useState(state.currentPrice);
  const [activeName, setActiveName] = useState(state.outcomeName);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>(() => loadRecentOrders());

  const handleKey = useCallback(
    (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); },
    [onClose]
  );
  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  const handleSuccess = useCallback((info: { side: string; amount: number; price: number }) => {
    setOrderPlaced(true);
    const newOrder: RecentOrder = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      side: info.side,
      outcome: activeName,
      amount: info.amount,
      price: info.price,
      ts: Date.now(),
    };
    saveRecentOrder(newOrder);
    setRecentOrders(loadRecentOrders());
  }, [activeName]);

  const selectToken = (token: TokenInfo) => {
    setActiveTokenId(token.tokenId);
    setActivePrice(token.price);
    setActiveName(token.name);
  };

  const isYesActive = state.yesToken ? activeTokenId === state.yesToken.tokenId : !activeName.endsWith(" No");
  const displayedRecentOrders = useMemo(() => recentOrders.slice(0, 3), [recentOrders]);

  // Read share balances for Yes/No tokens
  const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const;
  const CTF_BALANCE_ABI = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] }] as const;
  const { proxyAddress, address, isConnected } = useWalletStore();
  const balanceTarget = (proxyAddress ?? address) as `0x${string}` | undefined;

  const { data: yesShares } = useReadContract({
    address: CTF_ADDRESS, abi: CTF_BALANCE_ABI, functionName: "balanceOf",
    args: balanceTarget && state.yesToken ? [balanceTarget, BigInt(state.yesToken.tokenId)] : undefined,
    chainId: polygon.id,
    query: { enabled: isConnected && !!balanceTarget && !!state.yesToken, refetchInterval: 15_000 },
  });
  const { data: noShares } = useReadContract({
    address: CTF_ADDRESS, abi: CTF_BALANCE_ABI, functionName: "balanceOf",
    args: balanceTarget && state.noToken ? [balanceTarget, BigInt(state.noToken.tokenId)] : undefined,
    chainId: polygon.id,
    query: { enabled: isConnected && !!balanceTarget && !!state.noToken, refetchInterval: 15_000 },
  });
  const yesSharesNum = yesShares !== undefined ? Number(yesShares) / 1e6 : null;
  const noSharesNum = noShares !== undefined ? Number(noShares) / 1e6 : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.70)", backdropFilter: "blur(3px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full mx-4 bg-[var(--bg)] border border-[var(--border)] font-mono outline-none flex flex-col"
        style={{
          maxWidth: 560,
          maxHeight: "calc(100vh - 48px)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3 border-b border-[var(--border-subtle)] shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-[var(--text-faint)] uppercase tracking-[0.1em] truncate mb-1.5">
              {state.marketTitle}
            </div>

            {hasYesNo ? (
              <div className="flex gap-2">
                <button
                  onClick={() => selectToken(state.yesToken!)}
                  className={`flex-1 min-h-[44px] text-[12px] font-bold transition-colors flex flex-col items-center justify-center gap-0.5 ${
                    isYesActive
                      ? "bg-[#22c55e] text-black"
                      : "bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20"
                  }`}
                >
                  <span>Yes {(state.yesToken!.price * 100).toFixed(1)}¢</span>
                  {yesSharesNum !== null && yesSharesNum > 0 && (
                    <span className={`text-[9px] font-bold tabular-nums ${isYesActive ? "opacity-70" : "opacity-50"}`}>
                      {yesSharesNum.toFixed(2)} shares
                    </span>
                  )}
                </button>
                <button
                  onClick={() => selectToken(state.noToken!)}
                  className={`flex-1 min-h-[44px] text-[12px] font-bold transition-colors flex flex-col items-center justify-center gap-0.5 ${
                    !isYesActive
                      ? "bg-[#ff4444] text-white"
                      : "bg-[#ff4444]/10 text-[#ff4444] hover:bg-[#ff4444]/20"
                  }`}
                >
                  <span>No {(state.noToken!.price * 100).toFixed(1)}¢</span>
                  {noSharesNum !== null && noSharesNum > 0 && (
                    <span className={`text-[9px] font-bold tabular-nums ${!isYesActive ? "opacity-70" : "opacity-50"}`}>
                      {noSharesNum.toFixed(2)} shares
                    </span>
                  )}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span
                  className="text-[14px] font-bold"
                  style={{ color: activeName === "No" || activeName.endsWith(" No") ? "#ff4444" : "#22c55e" }}
                >
                  {activeName}
                </span>
                <span
                  className="text-[11px] tabular-nums px-1.5 py-0.5"
                  style={{
                    background: (activeName === "No" || activeName.endsWith(" No")) ? "rgba(255,68,68,0.12)" : "rgba(34,197,94,0.12)",
                    color: (activeName === "No" || activeName.endsWith(" No")) ? "#ff4444" : "#22c55e",
                  }}
                >
                  {(activePrice * 100).toFixed(1)}¢
                </span>
              </div>
            )}

            {state.smartMoney && state.smartMoney.netFlow !== "neutral" && (() => {
              const sm = state.smartMoney!;
              const netVol = sm.topWallets.reduce(
                (sum, w) => w.side === "BUY" ? sum + w.size : sum - w.size, 0
              );
              return (
                <div className="text-[9px] mt-1 tabular-nums" style={{
                  color: sm.netFlow === "bullish" ? "#22c55e" : "#ff4444"
                }}>
                  {sm.netFlow === "bullish" ? "↑" : "↓"}
                  {"$"}{Math.abs(netVol).toFixed(0)}
                  {" whale "}
                  {sm.netFlow === "bullish" ? "bullish" : "bearish"}
                  {" · "}
                  {sm.smartBuys + sm.whaleBuys} buys
                  {" / "}
                  {sm.smartSells + sm.whaleSells} sells
                </div>
              );
            })()}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-[var(--text-faint)] hover:text-[var(--text)] transition-colors mt-0.5 text-[16px] leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* ── Market stats bar ── */}
        {(state.volume != null || state.volume24h != null || state.liquidity != null || state.recentChange != null) && (
          <div className="flex items-center gap-3 px-4 py-1.5 border-b border-[var(--border-subtle)] text-[10px] tabular-nums text-[var(--text-faint)] shrink-0 flex-wrap">
            {state.recentChange != null && state.recentChange !== 0 && (
              <span className={state.recentChange > 0 ? "text-[#22c55e]" : "text-[#ff4444]"}>
                24h: {state.recentChange > 0 ? "+" : ""}{(state.recentChange * 100).toFixed(1)}%
              </span>
            )}
            {state.volume24h != null && state.volume24h > 0 && (
              <span>Vol 24h: ${state.volume24h >= 1_000_000 ? `${(state.volume24h / 1_000_000).toFixed(1)}M` : state.volume24h >= 1_000 ? `${(state.volume24h / 1_000).toFixed(0)}K` : state.volume24h.toFixed(0)}</span>
            )}
            {state.volume != null && state.volume > 0 && (
              <span>Vol: ${state.volume >= 1_000_000 ? `${(state.volume / 1_000_000).toFixed(1)}M` : state.volume >= 1_000 ? `${(state.volume / 1_000).toFixed(0)}K` : state.volume.toFixed(0)}</span>
            )}
            {state.liquidity != null && state.liquidity > 0 && (
              <span>Liq: ${state.liquidity >= 1_000_000 ? `${(state.liquidity / 1_000_000).toFixed(1)}M` : state.liquidity >= 1_000 ? `${(state.liquidity / 1_000).toFixed(0)}K` : state.liquidity.toFixed(0)}</span>
            )}
          </div>
        )}

        {/* ── Body: two columns ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left: Order Book */}
          <div className="w-[220px] shrink-0 border-r border-[var(--border-subtle)] flex flex-col py-2">
            <div className="text-[8px] uppercase tracking-[0.12em] text-[var(--text-ghost)] px-2 pb-1 shrink-0">
              order book
            </div>
            <div className="flex-1 min-h-0">
              <MiniOrderBook key={activeTokenId} tokenId={activeTokenId} currentPrice={activePrice} />
            </div>
          </div>

          {/* Right: Order form + recent orders */}
          <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
            {orderPlaced && (
              <div className="px-4 py-2 bg-[#22c55e]/10 border-b border-[#22c55e]/20 text-[11px] text-[#22c55e] flex items-center justify-between shrink-0">
                <span>✓ Order submitted</span>
                <button onClick={onClose} className="text-[#22c55e]/70 hover:text-[#22c55e] transition-colors text-[10px]">Close</button>
              </div>
            )}

            <div className="px-4 py-3">
              <OrderForm
                key={activeTokenId}
                tokenId={activeTokenId}
                currentPrice={activePrice}
                outcomeName={activeName}
                negRisk={state.negRisk}
                defaultSide={state.defaultSide}
                autoFocusAmount
                onSuccess={handleSuccess}
              />

              {displayedRecentOrders.length > 0 && (
                <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
                  <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)] mb-1.5">recent orders</div>
                  <div className="space-y-1">
                    {displayedRecentOrders.map((o) => (
                      <div key={o.id} className="text-[9px] text-[var(--text-faint)] tabular-nums flex items-center gap-1.5">
                        <span className={o.side === "BUY" ? "text-[#22c55e]" : "text-[#ff4444]"}>{o.side}</span>
                        <span className="text-[var(--text-dim)]">{o.outcome}</span>
                        <span className="text-[var(--text-ghost)]">${o.amount.toFixed(0)} @{(o.price * 100).toFixed(0)}¢</span>
                        <span className="text-[var(--text-ghost)]">·</span>
                        <span>{timeAgo(o.ts)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
