"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useConnect, useDisconnect, useAccount,
  useSwitchChain, useSignTypedData, useConnectors,
} from "wagmi";
import { polygon } from "wagmi/chains";
import { useWalletStore } from "@/stores/walletStore";
import { useI18n } from "@/i18n";
import {
  authorizeTradeSession,
  lookupProxyWallet,
  getCachedProxyWallet,
  setCachedProxyWallet,
  saveTradeSession,
  loadTradeSession,
  clearSavedTradeSession,
  getApprovedFlag,
} from "@/lib/tradeAuth";
import { useApproveProxy } from "@/hooks/useApproveProxy";
import {
  fetchOpenOrders,
  cancelOpenOrder,
  buildTokenIndex,
  type OpenOrder,
} from "@/lib/openOrders";
import { useMarketStore } from "@/stores/marketStore";

/** Format dollar amount: 3 significant digits with k/m suffix on mobile, full on desktop */
function fmtBal(v: number): string {
  if (window.innerWidth > 768) return `$${v.toFixed(2)}`;
  const abs = Math.abs(v);
  if (abs >= 1e6) return `$${+(v / 1e6).toPrecision(3)}m`;
  if (abs >= 1e3) return `$${+(v / 1e3).toPrecision(3)}k`;
  return `$${Math.round(v)}`;
}

interface WalletButtonProps {
  onRefresh?: () => void;
  loading?: boolean;
  lastSyncTime?: string | null;
  onTrade?: (state: import("./TradeModal").TradeModalState) => void;
  onTradePosition?: (title: string, outcome: string) => void;
}

function getRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-1 text-[var(--text-ghost)] hover:text-[var(--text-faint)] transition-colors shrink-0"
      title={t("common.copy")}
    >
      {copied ? (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="2 6 5 9 10 3"/></svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="3" width="7" height="8" rx="1"/><path d="M4 3V2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1"/></svg>
      )}
    </button>
  );
}

interface PositionItem {
  conditionId: string;
  title: string;
  outcome: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  cashPnl: number;
  image: string | null;
}

function OpenOrdersTab({
  openOrders,
  cancellingOrderId,
  onCancel,
  onTradePosition,
  onClose,
}: {
  openOrders: OpenOrder[];
  cancellingOrderId: string | null;
  onCancel: (id: string) => void;
  onTradePosition?: (title: string, outcome: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const mapped = useMarketStore((s) => s.mapped);
  const unmapped = useMarketStore((s) => s.unmapped);
  const tokenIndex = useMemo(() => buildTokenIndex([...mapped, ...unmapped]), [mapped, unmapped]);
  const resolved = useMemo(
    () => openOrders.map((o) => ({ order: o, market: tokenIndex.get(String(o.asset_id)) ?? null })),
    [openOrders, tokenIndex],
  );

  if (openOrders.length === 0) {
    return <div className="px-3 py-4 text-[11px] text-[var(--text-ghost)] text-center">{t("openOrders.noOpenOrders")}</div>;
  }

  return (
    <>
      {resolved.map(({ order, market }) => {
        const price = parseFloat(order.price) || 0;
        const total = parseFloat(order.original_size) || 0;
        const matched = parseFloat(order.size_matched) || 0;
        const isBuy = order.side === "BUY";
        const title = market?.title || `${order.asset_id.slice(0, 12)}…`;
        const image = market?.image;

        return (
          <div
            key={order.id}
            className="w-full px-3 py-2.5 text-left border-b border-[var(--border-subtle)] hover:bg-[var(--border-subtle)]/30 transition-colors group"
          >
            <div className="flex items-start gap-2.5">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" width={28} height={28} className="rounded shrink-0 mt-0.5 object-cover" />
              ) : (
                <div className="w-7 h-7 rounded shrink-0 mt-0.5 bg-[var(--border-subtle)] flex items-center justify-center text-[10px] text-[var(--text-ghost)]">
                  {title.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                {market ? (
                  <button
                    onClick={() => {
                      onTradePosition?.(market.title, market.outcome);
                      onClose();
                    }}
                    className="text-[12px] text-[var(--text-muted)] group-hover:text-[var(--text)] truncate leading-snug transition-colors block text-left w-full"
                    title={market.title}
                  >
                    {market.title}
                  </button>
                ) : (
                  <div className="text-[12px] text-[var(--text-ghost)] truncate leading-snug">{title}</div>
                )}
                <div className="flex items-center justify-between mt-1">
                  <span className="flex items-center gap-1.5 text-[11px] tabular-nums">
                    <span className={`font-bold ${isBuy ? "text-[#22c55e]" : "text-[#ff4444]"}`}>
                      {order.side} {market?.outcome}
                    </span>
                    <span className="text-[var(--text-faint)]">{(price * 100).toFixed(1)}¢</span>
                  </span>
                  <button
                    onClick={() => onCancel(order.id)}
                    disabled={cancellingOrderId === order.id}
                    className="shrink-0 text-[10px] px-1.5 py-0.5 border border-[var(--border)] text-[var(--text-ghost)] hover:text-[#ff4444] hover:border-[#ff4444]/40 transition-colors disabled:opacity-40"
                  >
                    {cancellingOrderId === order.id ? "…" : t("openOrders.cancel")}
                  </button>
                </div>
                <div className="flex items-center justify-between mt-0.5 text-[10px] tabular-nums text-[var(--text-faint)]">
                  <span>{t("openOrders.filled", { matched: matched.toFixed(0), total: total.toFixed(0) })}</span>
                  <span>${(total * price).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

export default function WalletButton({ onRefresh, loading, lastSyncTime, onTrade, onTradePosition }: WalletButtonProps) {
  const { t } = useI18n();
  const { address, isConnected, connector, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { setWallet, clearWallet, tradeSession, setTradeSession, clearTradeSession, proxyAddress, setProxyAddress } = useWalletStore();
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polyBalance, setPolyBalance] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = sessionStorage.getItem("pw:balance");
    return v !== null ? Number(v) : null;
  });
  const [portfolioValue, setPortfolioValue] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = sessionStorage.getItem("pw:portfolio");
    return v !== null ? Number(v) : null;
  });
  const { approve, status: approveStatus, error: approveError, markDone } = useApproveProxy();
  const allConnectors = useConnectors();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Proxy wallet lookup state
  const [resolvedProxy, setResolvedProxy] = useState<string | null>(null);
  const [proxyNotFound, setProxyNotFound] = useState(false);
  const [manualProxyInput, setManualProxyInput] = useState("");
  const lookupDoneRef = useRef<string | null>(null);

  const isPolygon = chainId === polygon.id;

  const handleMouseEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const handleMouseLeave = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  };

  // Sync wagmi → walletStore; restore persisted session on connect
  // Validates the saved session; if server lost it, silently re-authorize
  useEffect(() => {
    if (isConnected && address && isPolygon && chainId) {
      setWallet(address, chainId);
      const saved = loadTradeSession(address);
      if (saved) {
        // Optimistically set session immediately so effectiveProxy is available on first render
        setTradeSession(saved);
        // Verify session in background; if expired, re-authorize or clear
        fetch("/api/trade/balance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken: saved.sessionToken }),
        }).then(async (res) => {
          if (!res.ok) {
            // Session expired on server — silently re-authorize
            const proxy = saved.proxyAddress;
            if (proxy && signTypedDataAsync) {
              try {
                const session = await authorizeTradeSession(address, proxy, signTypedDataAsync);
                setTradeSession(session);
                saveTradeSession(address, session);
              } catch {
                clearSavedTradeSession(address);
                clearTradeSession();
              }
            } else {
              clearSavedTradeSession(address);
              clearTradeSession();
            }
          }
        }).catch(() => {
          // Network error — keep optimistic session
        });
      }
    } else {
      clearWallet();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, isPolygon, chainId, setWallet, clearWallet]);

  // Proactively look up proxy wallet when connected to Polygon
  useEffect(() => {
    if (!isConnected || !address || !isPolygon) {
      setResolvedProxy(null);
      setProxyNotFound(false);
      lookupDoneRef.current = null;
      return;
    }
    if (lookupDoneRef.current === address) return;
    lookupDoneRef.current = address;

    const cached = getCachedProxyWallet(address);
    if (cached) { setResolvedProxy(cached); setProxyAddress(cached); setProxyNotFound(false); return; }

    lookupProxyWallet(address).then((proxy) => {
      setResolvedProxy(proxy); setProxyAddress(proxy); setProxyNotFound(false);
    }).catch((e) => {
      if (e instanceof Error && e.message === "PROXY_NOT_FOUND") setProxyNotFound(true);
    });
  }, [isConnected, address, isPolygon, setProxyAddress]);

  // Fetch USDC.e balance + portfolio value — works with or without tradeSession
  // Uses resolvedProxy or tradeSession.proxyAddress (whichever is available)
  // Prefer the resolved proxy wallet (actual Polymarket safe) over tradeSession.proxyAddress
  // which may fall back to the owner EOA when proxy lookup failed during authorize
  const effectiveProxy = resolvedProxy ?? tradeSession?.proxyAddress ?? null;

  // Portfolio positions for hover dropdown
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const portfolioTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [portfolioTab, setPortfolioTab] = useState<"positions" | "orders">("positions");
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveProxy) { setPolyBalance(null); setPortfolioValue(null); return; }
    const proxyAddr = effectiveProxy;
    let cancelled = false;
    let seq = 0;

    const fetchBal = async (force = false) => {
      const mySeq = ++seq;
      try {
        // Public GET endpoint — no auth required, reads on-chain USDC.e balance
        const url = `/api/trade/balance?address=${proxyAddr}${force ? "&force=1" : ""}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && mySeq === seq && data.balance !== undefined) {
          setPolyBalance(data.balance);
          try { sessionStorage.setItem("pw:balance", String(data.balance)); } catch {}
        }
      } catch { /* ignore */ }
    };

    const fetchPortfolio = async () => {
      try {
        const res = await fetch(
          `https://data-api.polymarket.com/value?user=${proxyAddr}`,
          { signal: AbortSignal.timeout(8_000) }
        );
        if (!res.ok) return;
        const data = await res.json();
        const val = Array.isArray(data)
          ? data.reduce((s: number, p: { currentValue?: number; value?: number }) => s + (p.currentValue ?? p.value ?? 0), 0)
          : (data.portfolioValue ?? data.value ?? null);
        if (!cancelled && typeof val === "number") {
          setPortfolioValue(val);
          try { sessionStorage.setItem("pw:portfolio", String(val)); } catch {}
        }
      } catch { /* ignore */ }
    };

    fetchBal();
    fetchPortfolio();
    const iv = setInterval(() => { void fetchBal(); void fetchPortfolio(); }, 30_000);
    // Force bypass server cache when triggered by trade completion (debounced 200ms)
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const onRefreshEv = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { void fetchBal(true); void fetchPortfolio(); }, 200);
    };
    window.addEventListener("polyworld:refresh-header-balance", onRefreshEv);
    return () => { cancelled = true; clearInterval(iv); if (refreshTimer) clearTimeout(refreshTimer); window.removeEventListener("polyworld:refresh-header-balance", onRefreshEv); };
  }, [effectiveProxy]);

  // Fetch positions for portfolio hover dropdown
  useEffect(() => {
    if (!effectiveProxy) { setPositions([]); return; }
    let cancelled = false;
    const fetchPositions = async () => {
      try {
        const res = await fetch(
          `https://data-api.polymarket.com/positions?user=${encodeURIComponent(effectiveProxy)}&sortBy=CURRENT&limit=50`,
          { signal: AbortSignal.timeout(10_000) }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const arr = Array.isArray(data) ? data : data.positions || data.data || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items: PositionItem[] = arr.filter((p: any) => {
          const size = parseFloat(String(p.size || p.shares || 0));
          if (size < 0.01) return false;
          // Filter out closed/redeemed/resolved positions
          const closed = p.closed || p.resolved || p.redeemed || p.mergeable;
          if (closed) return false;
          // Filter out positions with curPrice at 0 or 1 (settled)
          const cur = parseFloat(String(p.curPrice || p.currentPrice || -1));
          if (cur <= 0.001 || cur >= 0.999) return false;
          return true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }).map((p: any) => {
          const size = parseFloat(String(p.size || p.shares || 0));
          const avgPrice = parseFloat(String(p.avgPrice || p.price || 0));
          const curPrice = parseFloat(String(p.curPrice || p.currentPrice || 0));
          return {
            conditionId: String(p.conditionId || p.market || ""),
            title: String(p.title || p.question || p.marketTitle || ""),
            outcome: String(p.outcome || ""),
            size,
            avgPrice,
            currentPrice: curPrice,
            cashPnl: (curPrice - avgPrice) * size,
            image: p.image || p.icon || p.marketImage || null,
          };
        });
        if (!cancelled) setPositions(items);
      } catch { /* ignore */ }
    };
    fetchPositions();
    const iv = setInterval(fetchPositions, 30_000);
    let posTimer: ReturnType<typeof setTimeout> | null = null;
    const onRefreshPositions = () => {
      if (posTimer) clearTimeout(posTimer);
      posTimer = setTimeout(() => { void fetchPositions(); }, 200);
    };
    window.addEventListener("polyworld:refresh-header-balance", onRefreshPositions);
    return () => { cancelled = true; clearInterval(iv); if (posTimer) clearTimeout(posTimer); window.removeEventListener("polyworld:refresh-header-balance", onRefreshPositions); };
  }, [effectiveProxy]);

  // Fetch open orders for portfolio hover dropdown
  useEffect(() => {
    if (!effectiveProxy || !tradeSession?.sessionToken) { setOpenOrders([]); return; }
    let cancelled = false;
    const fetchOrders = async () => {
      try {
        const result = await fetchOpenOrders(tradeSession.sessionToken);
        if (!cancelled) setOpenOrders(result);
      } catch { /* ignore */ }
    };
    fetchOrders();
    const iv = setInterval(fetchOrders, 15_000);
    let orderTimer: ReturnType<typeof setTimeout> | null = null;
    const onOrderPlaced = () => {
      if (orderTimer) clearTimeout(orderTimer);
      orderTimer = setTimeout(() => { void fetchOrders(); }, 200);
    };
    window.addEventListener("polyworld:order-placed", onOrderPlaced);
    return () => { cancelled = true; clearInterval(iv); if (orderTimer) clearTimeout(orderTimer); window.removeEventListener("polyworld:order-placed", onOrderPlaced); };
  }, [effectiveProxy, tradeSession?.sessionToken]);

  const handleCancelOrder = useCallback(async (orderId: string) => {
    if (!tradeSession?.sessionToken) return;
    setCancellingOrderId(orderId);
    try {
      await cancelOpenOrder(orderId, tradeSession.sessionToken);
      setOpenOrders((prev) => prev.filter((o) => o.id !== orderId));
    } catch { /* ignore */ }
    setCancellingOrderId(null);
  }, [tradeSession?.sessionToken]);

  // Restore approval state from localStorage
  useEffect(() => {
    if (!tradeSession || !address) return;
    const isEOA = tradeSession.proxyAddress.toLowerCase() === address.toLowerCase();
    if (!isEOA && getApprovedFlag(tradeSession.proxyAddress)) markDone();
  }, [tradeSession, address, markDone]);

  const handleConnect = useCallback((connectorId?: string) => {
    const target = connectorId
      ? connectors.find((c) => c.id === connectorId || c.uid === connectorId)
      : connectors.find((c) => c.id === "injected")
        ?? connectors.find((c) => c.type === "injected")
        ?? connectors[0];
    if (target) connect({ connector: target });
  }, [connect, connectors]);

  const handleDisconnect = useCallback(() => {
    const sessionToken = tradeSession?.sessionToken;
    if (sessionToken) {
      void fetch("/api/trade/auth", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken }),
      });
    }
    if (address) clearSavedTradeSession(address);
    disconnect();
    clearWallet();
    setPolyBalance(null);
    setPortfolioValue(null);
    try { sessionStorage.removeItem("pw:balance"); sessionStorage.removeItem("pw:portfolio"); } catch {}
    setResolvedProxy(null);
    setProxyNotFound(false);
    lookupDoneRef.current = null;
    setOpen(false);
  }, [disconnect, clearWallet, tradeSession, address]);

  const handleConfirmManualProxy = useCallback(() => {
    if (!address || !manualProxyInput.trim()) return;
    const proxy = manualProxyInput.trim();
    setCachedProxyWallet(address, proxy);
    setResolvedProxy(proxy);
    setProxyAddress(proxy);
    setProxyNotFound(false);
    setManualProxyInput("");
  }, [address, manualProxyInput, setProxyAddress]);

  const handleAuthorize = useCallback(async () => {
    if (!address) return;
    const proxy = resolvedProxy ?? getCachedProxyWallet(address) ?? (proxyNotFound ? address : null);
    if (!proxy) { setError("proxy wallet lookup not ready — please retry"); return; }
    setAuthorizing(true);
    setError(null);
    try {
      const session = await authorizeTradeSession(address, proxy, signTypedDataAsync);
      setTradeSession(session);
      if (chainId) setWallet(address, chainId);
      saveTradeSession(address, session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "authorization failed");
    } finally {
      setAuthorizing(false);
    }
  }, [address, resolvedProxy, proxyNotFound, signTypedDataAsync, setTradeSession, setWallet, chainId]);

  // ── Not connected: CONNECT button + modal ──
  if (!isConnected) {
    // EIP-6963 discovered wallets come with icons and proper names.
    // Filter out generic "Injected" when real wallets are detected, and deduplicate.
    const hasNamedWallet = connectors.some((c) => c.name !== "Injected" && c.type === "injected");
    const seen = new Set<string>();
    const uniqueConnectors = connectors.filter((c) => {
      if (hasNamedWallet && c.name === "Injected") return false;
      const key = c.name.toLowerCase().replace(/\s+wallet$/i, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const walletIconFor = (c: typeof connectors[0]) => {
      // EIP-6963 connectors provide their own icon
      if (c.icon) return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.icon} alt="" width={28} height={28} className="rounded-md" />
      );
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)]"><rect x="1" y="6" width="22" height="14" rx="2"/><path d="M1 10h22"/></svg>
      );
    };

    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold font-mono border border-[#22c55e]/40 text-[#22c55e] hover:border-[#22c55e]/70 hover:bg-[#22c55e]/5 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="1" y="6" width="22" height="14" rx="2"/><path d="M1 10h22"/>
          </svg>
          {t("wallet.connect")}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 bg-black/60 z-[300]" onClick={() => setOpen(false)} />
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[301] w-[340px] max-w-[90vw] border border-[var(--border)] bg-[var(--panel-bg)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="px-5 pt-5 pb-3 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#22c55e]">
                    <polygon points="22,12 17,3.4 7,3.4 2,12 7,20.6 17,20.6" />
                    <path d="M2 12h20M12 3.4L16 12l-4 8.6M12 3.4L8 12l4 8.6" />
                  </svg>
                  <span className="text-[15px] font-bold text-[var(--text)]">{t("wallet.welcomeTitle")}</span>
                </div>
                <p className="text-[11px] text-[var(--text-faint)]">{t("wallet.welcomeDesc")}</p>
              </div>

              {/* Wallet list */}
              <div className="px-4 pb-4 space-y-2">
                {uniqueConnectors.map((c) => (
                  <button
                    key={c.uid}
                    onClick={() => { handleConnect(c.uid); setOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 border border-[var(--border-subtle)] hover:border-[var(--text-ghost)] hover:bg-[var(--border-subtle)]/20 transition-colors"
                  >
                    {walletIconFor(c)}
                    <div className="text-left">
                      <div className="text-[12px] font-medium text-[var(--text)]">{c.name}</div>
                      <div className="text-[10px] text-[var(--text-ghost)]">{t("wallet.detectedInBrowser")}</div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Footer */}
              <div className="px-4 pb-4 pt-1 border-t border-[var(--border-subtle)]">
                <button onClick={() => setOpen(false)} className="w-full py-2 text-[11px] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors">
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  // ── Wrong chain ──
  if (!isPolygon) {
    return (
      <button
        onClick={() => switchChain({ chainId: polygon.id })}
        className="flex items-center justify-center w-7 h-7 border border-[#f59e0b]/50 text-[#f59e0b] hover:border-[#f59e0b]/80 transition-colors"
        title={t("trade.switchToPolygon")}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </button>
    );
  }

  const px = resolvedProxy ?? proxyAddress;
  const hasSeparateProxy = !!(px && px.toLowerCase() !== address?.toLowerCase());
  const isAuthorized = !!tradeSession;
  const isEOA = !!(address && tradeSession && tradeSession.proxyAddress.toLowerCase() === address.toLowerCase());
  const needsApprove = isAuthorized && !isEOA && approveStatus !== "done";

  // EIP-6963 connectors provide icon + name; resolve from allConnectors for latest state
  const liveConnector = allConnectors.find((c) => c.id === connector?.id) ?? connector;
  const walletIcon = liveConnector?.icon ?? connector?.icon;
  const walletName = liveConnector?.name ?? connector?.name ?? "";

  const walletFallback = walletIcon ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={walletIcon} alt={walletName} width={16} height={16} className="rounded-sm" />
  ) : (
    <span className="text-[10px] font-mono text-[var(--text-dim)]">
      {walletName.replace(/\s+wallet$/i, "").replace(/^injected$/i, "").slice(0, 2).toUpperCase()
        || (address ? address.slice(2, 4).toUpperCase() : "??")}
    </span>
  );

  const syncText = lastSyncTime ? getRelativeTime(lastSyncTime) : null;

  return (
    <div className="flex items-center gap-2">
      {/* Portfolio — hover for position details */}
      {(portfolioValue !== null || polyBalance !== null) && (
        <div
          className="relative"
          onMouseEnter={() => { if (portfolioTimer.current) clearTimeout(portfolioTimer.current); setPortfolioOpen(true); }}
          onMouseLeave={() => { portfolioTimer.current = setTimeout(() => setPortfolioOpen(false), 300); }}
        >
          <div
            className="flex items-center gap-1 px-3 py-1.5 text-[13px] tabular-nums border border-[var(--border-subtle)] cursor-default"
            style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.4)" }}
          >
            {portfolioValue !== null && (
              <span className="flex items-center gap-1.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-faint)] shrink-0">
                  <rect x="2" y="7" width="20" height="14" rx="2"/>
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                  <line x1="12" y1="12" x2="12" y2="16"/>
                  <line x1="10" y1="14" x2="14" y2="14"/>
                </svg>
                <span className="text-[var(--text-secondary)] font-bold">{fmtBal(portfolioValue)}</span>
              </span>
            )}
            {portfolioValue !== null && polyBalance !== null && (
              <span className="text-[var(--border)] select-none">|</span>
            )}
            {polyBalance !== null && (
              <span className="flex items-center gap-1.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-faint)] shrink-0">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v2M12 16v2M9 9.5c0-1 1.5-1.5 3-1.5s3 .5 3 2-1.5 2-3 2-3 1-3 2 1.5 2 3 2 3-.5 3-1.5"/>
                </svg>
                <span className="text-[var(--text-secondary)] font-bold">{fmtBal(polyBalance)}</span>
              </span>
            )}
          </div>

          {/* Portfolio positions / open orders dropdown */}
          {portfolioOpen && (positions.length > 0 || openOrders.length > 0) && (
            <div
              className="absolute right-0 top-full mt-1 w-[340px] max-h-[400px] overflow-y-auto bg-[var(--bg)] border border-[var(--border)] z-[200] font-mono"
              style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
            >
              {/* Tabs */}
              <div className="flex items-center border-b border-[var(--border-subtle)] sticky top-0 bg-[var(--bg)] z-10">
                <button
                  onClick={() => setPortfolioTab("positions")}
                  className={`flex-1 px-3 py-2 text-[10px] uppercase tracking-[0.1em] transition-colors ${
                    portfolioTab === "positions"
                      ? "text-[var(--text-muted)] border-b border-[var(--text-faint)]"
                      : "text-[var(--text-ghost)] hover:text-[var(--text-faint)]"
                  }`}
                >
                  {t("wallet.positions", { count: positions.length })}
                </button>
                <button
                  onClick={() => setPortfolioTab("orders")}
                  className={`flex-1 px-3 py-2 text-[10px] uppercase tracking-[0.1em] transition-colors ${
                    portfolioTab === "orders"
                      ? "text-[var(--text-muted)] border-b border-[var(--text-faint)]"
                      : "text-[var(--text-ghost)] hover:text-[var(--text-faint)]"
                  }`}
                >
                  {t("wallet.orders", { count: openOrders.length })}
                </button>
              </div>

              {portfolioTab === "positions" ? (
                positions.length > 0 ? positions.map((p) => (
                  <button
                    key={`${p.conditionId}-${p.outcome}`}
                    onClick={() => {
                      onTradePosition?.(p.title, p.outcome);
                      setPortfolioOpen(false);
                    }}
                    className="w-full px-3 py-2.5 text-left border-b border-[var(--border-subtle)] hover:bg-[#22c55e]/5 cursor-pointer transition-colors group"
                  >
                    <div className="flex items-start gap-2.5">
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image} alt="" width={28} height={28} className="rounded shrink-0 mt-0.5 object-cover" />
                      ) : (
                        <div className="w-7 h-7 rounded shrink-0 mt-0.5 bg-[var(--border-subtle)] flex items-center justify-center text-[10px] text-[var(--text-ghost)]">
                          {p.title.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] text-[var(--text-muted)] group-hover:text-[var(--text)] truncate leading-snug transition-colors">{p.title}</div>
                        <div className="flex items-center justify-between mt-1">
                          <span className={`text-[11px] font-bold ${p.outcome.toLowerCase() === "no" ? "text-[#ff4444]" : "text-[#22c55e]"}`}>
                            {p.outcome}
                          </span>
                          <span className="text-[11px] text-[var(--text-secondary)] font-bold tabular-nums">
                            {p.size.toFixed(2)} shares
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5 text-[10px] tabular-nums text-[var(--text-faint)]">
                          <span>{t("wallet.avgCur", { avg: (p.avgPrice * 100).toFixed(1), cur: (p.currentPrice * 100).toFixed(1) })}</span>
                          <span className={`font-bold ${p.cashPnl >= 0 ? "text-[#22c55e]" : "text-[#ff4444]"}`}>
                            {p.cashPnl >= 0 ? "+" : ""}${p.cashPnl.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                )) : (
                  <div className="px-3 py-4 text-[11px] text-[var(--text-ghost)] text-center">{t("wallet.noPositions")}</div>
                )
              ) : (
                <OpenOrdersTab
                  openOrders={openOrders}
                  cancellingOrderId={cancellingOrderId}
                  onCancel={handleCancelOrder}
                  onTradePosition={onTradePosition}
                  onClose={() => setPortfolioOpen(false)}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Wallet icon button + dropdown */}
      <div
        className="relative"
        ref={dropdownRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
      <button
        className={`relative flex items-center justify-center w-9 h-9 border transition-colors overflow-hidden ${
          open
            ? "border-[var(--text-muted)] bg-[var(--border-subtle)]"
            : "border-[var(--text-ghost)] hover:border-[var(--text-muted)]"
        }`}
        title={walletName || address || "wallet"}
      >
        {walletIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={walletIcon} alt={walletName} width={22} height={22} className="object-contain" />
        ) : (
          walletFallback
        )}
        {/* Status dot */}
        <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-[var(--bg)] ${
          isAuthorized ? (needsApprove ? "bg-[#f59e0b]" : "bg-[#22c55e]") : "bg-[var(--text-ghost)]"
        }`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-[220px] bg-[var(--bg)] border border-[var(--border)] z-[200] py-1 font-mono text-[11px]"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
        >
          {/* Wallet name */}
          {walletName && (
            <div className="px-3 py-1.5 text-[10px] text-[var(--text-ghost)] uppercase tracking-[0.1em] border-b border-[var(--border-subtle)]">
              {walletName}
            </div>
          )}

          {/* Addresses */}
          <div className="px-3 py-2 space-y-1.5 border-b border-[var(--border-subtle)]">
            {hasSeparateProxy && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[var(--text-ghost)] uppercase tracking-[0.06em] w-10 shrink-0">{t("wallet.safe")}</span>
                <span className="text-[var(--text-dim)] tabular-nums flex-1 text-right">
                  {px!.slice(0, 6)}…{px!.slice(-4)}
                </span>
                <CopyButton text={px!} />
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[var(--text-ghost)] uppercase tracking-[0.06em] w-10 shrink-0">
                {hasSeparateProxy ? t("wallet.owner") : t("wallet.eoa")}
              </span>
              <span className="text-[var(--text-dim)] tabular-nums flex-1 text-right">
                {address!.slice(0, 6)}…{address!.slice(-4)}
              </span>
              <CopyButton text={address!} />
            </div>
          </div>

          {/* Status / actions */}
          <div className="px-3 py-2 space-y-1.5 border-b border-[var(--border-subtle)]">
            {error && (
              <div className="text-[10px] text-[#ff4444] truncate" title={error}>{error}</div>
            )}

            {!isAuthorized ? (
              <>
                {proxyNotFound ? (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-[#f59e0b]">{t("wallet.noAccountFound")}</div>
                    <div className="text-[10px] text-[var(--text-faint)] leading-snug">
                      {t("wallet.needAccountToTrade")}
                    </div>
                    <a
                      href="https://polymarket.com?r=0xaa"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full py-1.5 text-center text-[11px] font-bold bg-[#8b5cf6]/10 text-[#8b5cf6] border border-[#8b5cf6]/30 hover:bg-[#8b5cf6]/20 transition-colors"
                    >
                      {t("wallet.registerOnPolymarket")}
                    </a>
                  </div>
                ) : (
                  <button
                    onClick={handleAuthorize}
                    disabled={authorizing}
                    className="w-full py-1.5 text-center text-[11px] font-bold bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30 hover:bg-[#22c55e]/15 transition-colors disabled:opacity-40"
                  >
                    {authorizing ? t("trade.authorizingFull") : t("trade.authorizeTradingFull")}
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[var(--text-faint)]">{t("wallet.status")}</span>
                <span className="text-[10px] text-[#22c55e]">● {t("wallet.ready")}</span>
              </div>
            )}

            {isAuthorized && needsApprove && (
              <button
                onClick={() => approve(tradeSession!.sessionToken, tradeSession!.proxyAddress)}
                disabled={approveStatus === "preparing" || approveStatus === "signing" || approveStatus === "submitting"}
                className="w-full py-1.5 text-center text-[11px] font-bold bg-[#a78bfa]/10 text-[#a78bfa] border border-[#a78bfa]/30 hover:bg-[#a78bfa]/15 transition-colors disabled:opacity-40"
                title={approveError ?? "Approve USDC.e and outcome tokens (one-time, gasless)"}
              >
                {approveStatus === "idle"       && t("wallet.approveTokens")}
                {approveStatus === "preparing"  && t("wallet.preparing")}
                {approveStatus === "signing"    && t("trade.signInWallet")}
                {approveStatus === "submitting" && t("wallet.submitting")}
                {approveStatus === "error"      && t("wallet.retryApprove")}
              </button>
            )}
          </div>

          {/* Refresh + sync info */}
          {onRefresh && (
            <div className="px-3 py-2 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <span className="text-[10px] text-[var(--text-ghost)]">
                {syncText ? t("wallet.syncedTime", { time: syncText }) : "—"}
              </span>
              <button
                onClick={() => { onRefresh(); setOpen(false); }}
                disabled={loading}
                className="text-[10px] px-2 py-0.5 border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--text-ghost)] transition-colors disabled:opacity-40"
              >
                {loading ? t("common.refreshing") : t("common.refresh")}
              </button>
            </div>
          )}

          {/* Disconnect */}
          <button
            onClick={handleDisconnect}
            className="w-full px-3 py-2 text-left text-[11px] text-[#ff4444]/70 hover:text-[#ff4444] hover:bg-[#ff4444]/5 transition-colors"
          >
            {t("wallet.disconnect")}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
