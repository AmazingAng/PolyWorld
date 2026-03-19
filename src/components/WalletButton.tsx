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

export default function WalletButton({ onRefresh, loading, lastSyncTime }: WalletButtonProps) {
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
  // Validates the saved session is still alive on the server side
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
        }).then((res) => {
          if (res.ok) {
            setTradeSession(saved);
          } else {
            // Session expired on server — clear stale token
            clearSavedTradeSession(address);
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

  // Restore approval state from localStorage
  useEffect(() => {
    if (!tradeSession || !address) return;
    const isEOA = tradeSession.proxyAddress.toLowerCase() === address.toLowerCase();
    if (!isEOA && getApprovedFlag(tradeSession.proxyAddress)) markDone();
  }, [tradeSession, address, markDone]);

  const handleConnect = useCallback(() => {
    // Prefer the generic injected connector, then any EIP-6963 discovered wallet
    const injector = connectors.find((c) => c.id === "injected")
      ?? connectors.find((c) => c.type === "injected")
      ?? connectors[0];
    if (injector) connect({ connector: injector });
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

  // ── Not connected: wallet icon button ──
  if (!isConnected) {
    return (
      <button
        onClick={handleConnect}
        className="flex items-center justify-center w-7 h-7 border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--text-ghost)] transition-colors"
        title="Connect wallet"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1" y="6" width="22" height="14" rx="2"/>
          <path d="M16 14a1 1 0 1 0 2 0 1 1 0 0 0-2 0"/>
          <path d="M1 10h22"/>
        </svg>
      </button>
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

  // Resolve live connector (EIP-6963 connectors carry runtime icons)
  const liveConnector = allConnectors.find((c) => c.id === connector?.id) ?? connector;
  const walletIcon = liveConnector?.icon ?? connector?.icon;
  const walletName = liveConnector?.name ?? connector?.name ?? "";

  // When connector name is generic ("Injected"), sniff window properties to identify the wallet
  const detectedWallet = (() => {
    if (typeof window === "undefined") return null;
    const w = window as unknown as Record<string, unknown>;
    const eth = w.ethereum as Record<string, unknown> | undefined;
    if (w.okxwallet || eth?.isOKExWallet || eth?.isOkxWallet) return "okx";
    if (eth?.isMetaMask && !eth?.isRabby) return "metamask";
    if (eth?.isRabby) return "rabby";
    if (eth?.isCoinbaseWallet) return "coinbase";
    return null;
  })();

  const walletKey = (() => {
    const n = walletName.toLowerCase();
    if (n.includes("okx")) return "okx";
    if (n.includes("metamask")) return "metamask";
    if (n.includes("rabby")) return "rabby";
    if (n.includes("coinbase")) return "coinbase";
    return detectedWallet;
  })();

  const OKXIcon = () => (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="currentColor" className="text-[var(--text)]">
      <rect x="4" y="4" width="9" height="9" rx="1"/><rect x="19" y="4" width="9" height="9" rx="1"/>
      <rect x="4" y="19" width="9" height="9" rx="1"/><rect x="19" y="19" width="9" height="9" rx="1"/>
    </svg>
  );
  const MetaMaskIcon = () => (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
      <path d="M28 4L18 11.2l1.9-4.5L28 4z" fill="#E17726"/>
      <path d="M4 4l9.9 7.3L12.1 6.7 4 4z" fill="#E27625"/>
      <path d="M24.3 21.4l-2.7 4.1 5.8 1.6 1.7-5.6-4.8-.1z" fill="#E27625"/>
      <path d="M2.9 21.5l1.6 5.6 5.8-1.6-2.7-4.1-4.7.1z" fill="#E27625"/>
      <path d="M10 15.1l-1.6 2.4 5.7.3-.2-6.1-3.9 3.4z" fill="#E27625"/>
      <path d="M22 15.1l-4-3.5-.1 6.2 5.7-.3L22 15.1z" fill="#E27625"/>
      <path d="M10.3 25.5l3.4-1.6-2.9-2.3-.5 3.9z" fill="#E27625"/>
      <path d="M18.3 23.9l3.4 1.6-.5-3.9-2.9 2.3z" fill="#E27625"/>
    </svg>
  );

  const walletFallback = (() => {
    if (walletKey === "okx") return <OKXIcon />;
    if (walletKey === "metamask") return <MetaMaskIcon />;
    if (walletKey === "rabby") return <span className="text-[10px] font-mono text-[#a78bfa]">RB</span>;
    if (walletKey === "coinbase") return (
      <svg width="16" height="16" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#0052FF"/><rect x="10" y="13" width="12" height="6" rx="3" fill="white"/></svg>
    );
    const initials = walletName.replace(/\s+wallet$/i, "").replace(/^injected$/i, "").slice(0, 2).toUpperCase()
      || (address ? address.slice(2, 4).toUpperCase() : "??");
    return <span className="text-[10px] font-mono text-[var(--text-dim)]">{initials}</span>;
  })();

  const syncText = lastSyncTime ? getRelativeTime(lastSyncTime) : null;

  return (
    <div
      className="relative flex items-center gap-2"
      ref={dropdownRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Balances — visible when proxy wallet is known (no auth required) */}
      {(portfolioValue !== null || polyBalance !== null) && (
        <div
          className="flex items-center gap-2.5 px-2.5 py-1 text-[11px] tabular-nums border border-[var(--border-subtle)]"
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
                {proxyNotFound && !manualProxyInput && (
                  <div className="space-y-1">
                    <div className="text-[10px] text-[#f59e0b]">No Polymarket proxy found</div>
                    <div className="text-[9px] text-[var(--text-faint)] leading-snug">
                      You can still authorize with your EOA, or paste your proxy address below if you have one.
                    </div>
                  </div>
                )}
                {proxyNotFound && (
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="text"
                      value={manualProxyInput}
                      onChange={(e) => setManualProxyInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleConfirmManualProxy()}
                      placeholder="0x… proxy (optional)"
                      className="text-[10px] font-mono px-1 py-px border border-[var(--border)] bg-transparent text-[var(--text)] flex-1 outline-none focus:border-[#f59e0b]/70 placeholder:text-[var(--text-ghost)]"
                    />
                    <button
                      onClick={handleConfirmManualProxy}
                      disabled={!manualProxyInput.trim()}
                      className="text-[10px] px-1.5 py-px border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors disabled:opacity-40"
                    >ok</button>
                  </div>
                )}
                <button
                  onClick={handleAuthorize}
                  disabled={authorizing}
                  className="w-full py-1.5 text-center text-[11px] font-bold bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30 hover:bg-[#22c55e]/15 transition-colors disabled:opacity-40"
                >
                  {authorizing ? "Authorizing…" : "Authorize Trading"}
                </button>
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
