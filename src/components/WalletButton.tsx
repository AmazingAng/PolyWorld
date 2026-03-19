"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useConnect, useDisconnect, useAccount,
  useSwitchChain, useSignTypedData, useConnectors,
} from "wagmi";
import { polygon } from "wagmi/chains";
import { useWalletStore } from "@/stores/walletStore";
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

interface WalletButtonProps {
  onRefresh?: () => void;
  loading?: boolean;
  lastSyncTime?: string | null;
  onTrade?: (state: import("./TradeModal").TradeModalState) => void;
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
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-1 text-[var(--text-ghost)] hover:text-[var(--text-faint)] transition-colors shrink-0"
      title="Copy"
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
}

export default function WalletButton({ onRefresh, loading, lastSyncTime, onTrade }: WalletButtonProps) {
  const { address, isConnected, connector, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { setWallet, clearWallet, tradeSession, setTradeSession, proxyAddress, setProxyAddress } = useWalletStore();
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polyBalance, setPolyBalance] = useState<number | null>(null);
  const [portfolioValue, setPortfolioValue] = useState<number | null>(null);
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
        // Verify session is still valid on the server
        fetch("/api/trade/balance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken: saved.sessionToken }),
        }).then(async (res) => {
          if (res.ok) {
            setTradeSession(saved);
          } else {
            // Session expired on server — silently re-authorize
            // (user already authorized before, so we have proxy cached)
            const proxy = saved.proxyAddress;
            if (proxy && signTypedDataAsync) {
              try {
                const session = await authorizeTradeSession(address, proxy, signTypedDataAsync);
                setTradeSession(session);
                saveTradeSession(address, session);
              } catch {
                // Signature rejected or failed — clear stale session
                clearSavedTradeSession(address);
              }
            } else {
              clearSavedTradeSession(address);
            }
          }
        }).catch(() => {
          // Network error — still load optimistically
          setTradeSession(saved);
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
  }, [isConnected, address, isPolygon]);

  // Fetch USDC.e balance + portfolio value — works with or without tradeSession
  // Uses resolvedProxy or tradeSession.proxyAddress (whichever is available)
  const effectiveProxy = tradeSession?.proxyAddress ?? resolvedProxy;

  // Portfolio positions for hover dropdown
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const portfolioTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!effectiveProxy) { setPolyBalance(null); setPortfolioValue(null); return; }
    const proxyAddr = effectiveProxy;
    let cancelled = false;
    let seq = 0;

    const fetchBal = async () => {
      const mySeq = ++seq;
      try {
        // Public GET endpoint — no auth required, reads on-chain USDC.e balance
        const res = await fetch(`/api/trade/balance?address=${proxyAddr}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && mySeq === seq && data.balance !== undefined) setPolyBalance(data.balance);
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
        if (!cancelled && typeof val === "number") setPortfolioValue(val);
      } catch { /* ignore */ }
    };

    fetchBal();
    fetchPortfolio();
    const iv = setInterval(() => { void fetchBal(); void fetchPortfolio(); }, 30_000);
    const onRefreshEv = () => { void fetchBal(); void fetchPortfolio(); };
    window.addEventListener("polyworld:refresh-header-balance", onRefreshEv);
    return () => { cancelled = true; clearInterval(iv); window.removeEventListener("polyworld:refresh-header-balance", onRefreshEv); };
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
        const items: PositionItem[] = arr.filter((p: any) => parseFloat(String(p.size || p.shares || 0)) > 0.01).map((p: any) => {
          const size = parseFloat(String(p.size || p.shares || 0));
          const avgPrice = parseFloat(String(p.avgPrice || p.price || 0));
          const curPrice = parseFloat(String(p.curPrice || p.currentPrice || avgPrice));
          return {
            conditionId: String(p.conditionId || p.market || ""),
            title: String(p.title || p.question || p.marketTitle || ""),
            outcome: String(p.outcome || ""),
            size,
            avgPrice,
            currentPrice: curPrice,
            cashPnl: (curPrice - avgPrice) * size,
          };
        });
        if (!cancelled) setPositions(items);
      } catch { /* ignore */ }
    };
    fetchPositions();
    const iv = setInterval(fetchPositions, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [effectiveProxy]);

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
  }, [address, manualProxyInput]);

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
          CONNECT
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
                  <span className="text-[15px] font-bold text-[var(--text)]">Welcome to PolyWorld</span>
                </div>
                <p className="text-[11px] text-[var(--text-faint)]">Connect your wallet to start trading on Polymarket</p>
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
                      <div className="text-[9px] text-[var(--text-ghost)]">Detected in browser</div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Footer */}
              <div className="px-4 pb-4 pt-1 border-t border-[var(--border-subtle)]">
                <button onClick={() => setOpen(false)} className="w-full py-2 text-[11px] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors">
                  Cancel
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
        title="Switch to Polygon"
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
    <div
      className="relative flex items-center gap-2"
      ref={dropdownRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Portfolio — hover for position details */}
      {(portfolioValue !== null || polyBalance !== null) && (
        <div
          className="relative"
          onMouseEnter={() => { if (portfolioTimer.current) clearTimeout(portfolioTimer.current); setPortfolioOpen(true); }}
          onMouseLeave={() => { portfolioTimer.current = setTimeout(() => setPortfolioOpen(false), 300); }}
        >
          <div
            className="flex items-center gap-2.5 px-2.5 py-1 text-[11px] tabular-nums border border-[var(--border-subtle)] cursor-default"
            style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.4)" }}
          >
            {portfolioValue !== null && (
              <span className="flex items-center gap-1">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-faint)] shrink-0">
                  <rect x="2" y="7" width="20" height="14" rx="2"/>
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                  <line x1="12" y1="12" x2="12" y2="16"/>
                  <line x1="10" y1="14" x2="14" y2="14"/>
                </svg>
                <span className="text-[var(--text-secondary)] font-bold">${portfolioValue.toFixed(2)}</span>
              </span>
            )}
            {portfolioValue !== null && polyBalance !== null && (
              <span className="text-[var(--border)] select-none">|</span>
            )}
            {polyBalance !== null && (
              <span className="flex items-center gap-1">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-faint)] shrink-0">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v2M12 16v2M9 9.5c0-1 1.5-1.5 3-1.5s3 .5 3 2-1.5 2-3 2-3 1-3 2 1.5 2 3 2 3-.5 3-1.5"/>
                </svg>
                <span className="text-[var(--text-secondary)] font-bold">${polyBalance.toFixed(2)}</span>
              </span>
            )}
          </div>

          {/* Portfolio positions dropdown */}
          {portfolioOpen && positions.length > 0 && (
            <div
              className="absolute right-0 top-full mt-1 w-[300px] max-h-[360px] overflow-y-auto bg-[var(--bg)] border border-[var(--border)] z-[200] font-mono"
              style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
            >
              <div className="px-3 py-1.5 text-[9px] text-[var(--text-ghost)] uppercase tracking-[0.1em] border-b border-[var(--border-subtle)] sticky top-0 bg-[var(--bg)]">
                Positions · {positions.length}
              </div>
              {positions.map((p) => (
                <button
                  key={`${p.conditionId}-${p.outcome}`}
                  onClick={() => {
                    if (onTrade) {
                      onTrade({
                        tokenId: p.conditionId,
                        currentPrice: p.currentPrice,
                        outcomeName: p.outcome,
                        marketTitle: p.title,
                        negRisk: false,
                        defaultSide: "SELL",
                      });
                    }
                    setPortfolioOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left border-b border-[var(--border-subtle)] hover:bg-[var(--border-subtle)]/20 transition-colors"
                >
                  <div className="text-[10px] text-[var(--text)] truncate leading-snug">{p.title}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-[10px] font-bold ${p.outcome.toLowerCase() === "no" ? "text-[#ff4444]" : "text-[#22c55e]"}`}>
                      {p.outcome}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)] font-bold tabular-nums">
                      {p.size.toFixed(2)} shares
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5 text-[9px] tabular-nums text-[var(--text-faint)]">
                    <span>Avg: {(p.avgPrice * 100).toFixed(1)}¢ · Cur: {(p.currentPrice * 100).toFixed(1)}¢</span>
                    <span className={p.cashPnl >= 0 ? "text-[#22c55e]" : "text-[#ff4444]"}>
                      {p.cashPnl >= 0 ? "+" : ""}${p.cashPnl.toFixed(2)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wallet icon button */}
      <button
        className={`relative flex items-center justify-center w-7 h-7 border transition-colors overflow-hidden ${
          open
            ? "border-[var(--text-faint)] bg-[var(--border-subtle)]"
            : "border-[var(--border-subtle)] hover:border-[var(--text-ghost)]"
        }`}
        title={walletName || address || "wallet"}
      >
        {walletIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={walletIcon} alt={walletName} width={18} height={18} className="object-contain" />
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
            <div className="px-3 py-1.5 text-[9px] text-[var(--text-ghost)] uppercase tracking-[0.1em] border-b border-[var(--border-subtle)]">
              {walletName}
            </div>
          )}

          {/* Addresses */}
          <div className="px-3 py-2 space-y-1.5 border-b border-[var(--border-subtle)]">
            {hasSeparateProxy && (
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-[var(--text-ghost)] uppercase tracking-[0.06em] w-10 shrink-0">Safe</span>
                <span className="text-[var(--text-dim)] tabular-nums flex-1 text-right">
                  {px!.slice(0, 6)}…{px!.slice(-4)}
                </span>
                <CopyButton text={px!} />
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-[var(--text-ghost)] uppercase tracking-[0.06em] w-10 shrink-0">
                {hasSeparateProxy ? "Owner" : "EOA"}
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
                    <div className="text-[10px] text-[#f59e0b]">No Polymarket account found</div>
                    <div className="text-[9px] text-[var(--text-faint)] leading-snug">
                      You need a Polymarket account to trade. Register and deploy your Safe wallet first.
                    </div>
                    <a
                      href="https://polymarket.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full py-1.5 text-center text-[11px] font-bold bg-[#8b5cf6]/10 text-[#8b5cf6] border border-[#8b5cf6]/30 hover:bg-[#8b5cf6]/20 transition-colors"
                    >
                      Register on Polymarket
                    </a>
                  </div>
                ) : (
                  <button
                    onClick={handleAuthorize}
                    disabled={authorizing}
                    className="w-full py-1.5 text-center text-[11px] font-bold bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30 hover:bg-[#22c55e]/15 transition-colors disabled:opacity-40"
                  >
                    {authorizing ? "Authorizing…" : "Authorize Trading"}
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[var(--text-faint)]">Status</span>
                <span className="text-[10px] text-[#22c55e]">● ready</span>
              </div>
            )}

            {isAuthorized && needsApprove && (
              <button
                onClick={() => approve(tradeSession!.sessionToken, tradeSession!.proxyAddress)}
                disabled={approveStatus === "preparing" || approveStatus === "signing" || approveStatus === "submitting"}
                className="w-full py-1.5 text-center text-[11px] font-bold bg-[#a78bfa]/10 text-[#a78bfa] border border-[#a78bfa]/30 hover:bg-[#a78bfa]/15 transition-colors disabled:opacity-40"
                title={approveError ?? "Approve USDC.e and outcome tokens (one-time, gasless)"}
              >
                {approveStatus === "idle"       && "Approve Tokens"}
                {approveStatus === "preparing"  && "Preparing…"}
                {approveStatus === "signing"    && "Sign in wallet…"}
                {approveStatus === "submitting" && "Submitting…"}
                {approveStatus === "error"      && "Retry Approve"}
              </button>
            )}
          </div>

          {/* Refresh + sync info */}
          {onRefresh && (
            <div className="px-3 py-2 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <span className="text-[10px] text-[var(--text-ghost)]">
                {syncText ? `synced ${syncText}` : "—"}
              </span>
              <button
                onClick={() => { onRefresh(); setOpen(false); }}
                disabled={loading}
                className="text-[10px] px-2 py-0.5 border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--text-ghost)] transition-colors disabled:opacity-40"
              >
                {loading ? "refreshing…" : "refresh"}
              </button>
            </div>
          )}

          {/* Disconnect */}
          <button
            onClick={handleDisconnect}
            className="w-full px-3 py-2 text-left text-[11px] text-[#ff4444]/70 hover:text-[#ff4444] hover:bg-[#ff4444]/5 transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
