"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useConnect, useDisconnect, useAccount, useChainId,
  useSwitchChain, useSignTypedData,
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

export default function WalletButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { setWallet, clearWallet, tradeSession, setTradeSession, proxyAddress } = useWalletStore();
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polyBalance, setPolyBalance] = useState<number | null>(null);
  const { approve, status: approveStatus, error: approveError, markDone } = useApproveProxy();

  // Proxy wallet lookup state
  const [resolvedProxy, setResolvedProxy] = useState<string | null>(null);
  const [proxyNotFound, setProxyNotFound] = useState(false);
  const [manualProxyInput, setManualProxyInput] = useState("");
  const lookupDoneRef = useRef<string | null>(null); // tracks which address we've looked up

  const isPolygon = chainId === polygon.id;

  // Sync wagmi → walletStore; restore persisted session on connect
  useEffect(() => {
    if (isConnected && address && isPolygon) {
      setWallet(address, chainId);
      // Restore previously authorized session (survives page refresh)
      const saved = loadTradeSession(address);
      if (saved) setTradeSession(saved);
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
    if (lookupDoneRef.current === address) return; // already looked up for this address

    lookupDoneRef.current = address;

    // Check localStorage cache first (sync, instant)
    const cached = getCachedProxyWallet(address);
    if (cached) {
      setResolvedProxy(cached);
      setProxyNotFound(false);
      return;
    }

    // Async API lookup
    lookupProxyWallet(address).then((proxy) => {
      setResolvedProxy(proxy);
      setProxyNotFound(false);
    }).catch((e) => {
      if (e instanceof Error && e.message === "PROXY_NOT_FOUND") {
        setProxyNotFound(true);
      }
      // Other errors: silently ignore, user can still try authorize
    });
  }, [isConnected, address, isPolygon]);

  // Fetch USDC.e balance of proxy wallet (server-side RPC, no CSP issue)
  useEffect(() => {
    if (!tradeSession?.sessionToken) { setPolyBalance(null); return; }
    let cancelled = false;
    const fetchBal = async () => {
      try {
        const res = await fetch("/api/trade/balance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken: tradeSession.sessionToken }),
        });
        if (res.status === 401 || res.status === 404) {
          // Session expired (e.g. server restarted) — clear it so user can re-authorize
          if (!cancelled && address) clearSavedTradeSession(address);
          if (!cancelled) useWalletStore.getState().clearTradeSession();
          return;
        }
        const data = await res.json();
        if (!cancelled && data.balance !== undefined) setPolyBalance(data.balance);
      } catch { /* ignore */ }
    };
    fetchBal();
    const iv = setInterval(fetchBal, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [tradeSession, address]);

  // Restore approval state from localStorage when session is available
  useEffect(() => {
    if (!tradeSession || !address) return;
    const isEOA = tradeSession.proxyAddress.toLowerCase() === address.toLowerCase();
    if (!isEOA && getApprovedFlag(tradeSession.proxyAddress)) {
      markDone();
    }
  }, [tradeSession, address, markDone]);

  const handleConnect = useCallback(() => {
    const injector = connectors.find((c) => c.id === "injected") ?? connectors[0];
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
    setResolvedProxy(null);
    setProxyNotFound(false);
    lookupDoneRef.current = null;
  }, [disconnect, clearWallet, tradeSession]);

  const handleConfirmManualProxy = useCallback(() => {
    if (!address || !manualProxyInput.trim()) return;
    const proxy = manualProxyInput.trim();
    setCachedProxyWallet(address, proxy);
    setResolvedProxy(proxy);
    setProxyNotFound(false);
    setManualProxyInput("");
  }, [address, manualProxyInput]);

  const handleAuthorize = useCallback(async () => {
    if (!address) return;
    // Fall back to EOA only when confirmed no proxy (proxyNotFound).
    // If lookup simply hasn't resolved yet or had a transient error, surface that as an error.
    const proxy = resolvedProxy ?? getCachedProxyWallet(address) ?? (proxyNotFound ? address : null);
    if (!proxy) {
      setError("proxy wallet lookup failed — please wait and retry");
      return;
    }
    setAuthorizing(true);
    setError(null);
    try {
      const session = await authorizeTradeSession(address, proxy, signTypedDataAsync);
      setTradeSession(session);
      setWallet(address, chainId);
      saveTradeSession(address, session); // persist across page refreshes
    } catch (e) {
      setError(e instanceof Error ? e.message : "authorization failed");
    } finally {
      setAuthorizing(false);
    }
  }, [address, resolvedProxy, proxyNotFound, signTypedDataAsync, setTradeSession, setWallet, chainId]);

  if (!isConnected) {
    return (
      <button
        onClick={handleConnect}
        className="text-[11px] px-2 py-px border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[#22c55e]/40 transition-colors"
        title="Connect wallet to trade"
      >
        connect wallet
      </button>
    );
  }

  if (!isPolygon) {
    return (
      <button
        onClick={() => switchChain({ chainId: polygon.id })}
        className="text-[11px] px-2 py-px border border-[#f59e0b]/40 text-[#f59e0b] hover:border-[#f59e0b]/70 transition-colors"
        title="Switch to Polygon"
      >
        switch to polygon
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {error && (
        <span className="text-[9px] text-[#ff4444] max-w-[100px] truncate" title={error}>{error}</span>
      )}

      {polyBalance !== null && (
        <span className="text-[11px] tabular-nums text-[var(--text-dim)]" title={`USDC.e balance of proxy wallet ${proxyAddress}`}>
          ${polyBalance.toFixed(2)}
        </span>
      )}

      {/* No Polymarket account found — guide user to sign up or enter manually */}
      {proxyNotFound && !tradeSession && (
        <div className="flex flex-col gap-1 text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="text-[#f59e0b]">no polymarket account found</span>
            <button
              onClick={() => {
                setProxyNotFound(false);
                lookupDoneRef.current = null;
                if (address) {
                  lookupProxyWallet(address)
                    .then((proxy) => { setResolvedProxy(proxy); setProxyNotFound(false); })
                    .catch((e) => { if (e instanceof Error && e.message === "PROXY_NOT_FOUND") setProxyNotFound(true); });
                }
              }}
              className="text-[#777] hover:text-[var(--text)] transition-colors underline underline-offset-2"
            >
              retry
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <a
              href="https://polymarket.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-1.5 py-px border border-[#f59e0b]/40 text-[#f59e0b] hover:border-[#f59e0b]/70 transition-colors"
            >
              sign up on polymarket ↗
            </a>
            <span className="text-[#555]">then retry</span>
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <input
              type="text"
              value={manualProxyInput}
              onChange={(e) => setManualProxyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConfirmManualProxy()}
              placeholder="or paste wallet 0x… from settings"
              title="polymarket.com/settings → copy wallet address"
              className="text-[10px] font-mono px-1 py-px border border-[#333] bg-transparent text-[var(--text)] w-[200px] outline-none focus:border-[#f59e0b]/70 placeholder:text-[#444]"
            />
            <button
              onClick={handleConfirmManualProxy}
              disabled={!manualProxyInput.trim()}
              className="text-[10px] px-1.5 py-px border border-[#333] text-[#777] hover:border-[#f59e0b]/70 hover:text-[#f59e0b] transition-colors disabled:opacity-40"
            >
              ok
            </button>
          </div>
        </div>
      )}

      {!tradeSession ? (
        <button
          onClick={handleAuthorize}
          disabled={authorizing}
          className="text-[11px] px-2 py-px border border-[#22c55e]/30 text-[#22c55e] hover:border-[#22c55e]/60 transition-colors disabled:opacity-40"
        >
          {authorizing ? "authorizing…" : "authorize"}
        </button>
      ) : (
        <>
          <span className="text-[9px] text-[#22c55e] px-1 border border-[#22c55e]/20">ready</span>
          {(() => {
            const isEOA = !!(address && tradeSession &&
              tradeSession.proxyAddress.toLowerCase() === address.toLowerCase());
            if (isEOA) return null; // EOA users don't need Safe relayer approval
            return approveStatus !== "done" && (
            <button
              onClick={() => approve(tradeSession.sessionToken, tradeSession.proxyAddress)}
              disabled={approveStatus === "preparing" || approveStatus === "signing" || approveStatus === "submitting"}
              className="text-[10px] px-1.5 py-px border border-[#a78bfa]/40 text-[#a78bfa] hover:border-[#a78bfa]/70 transition-colors disabled:opacity-40"
              title={approveError ?? "Approve USDC.e and outcome tokens (one-time, gasless)"}
            >
              {approveStatus === "idle"       && "approve tokens"}
              {approveStatus === "preparing"  && "preparing…"}
              {approveStatus === "signing"    && "sign in wallet…"}
              {approveStatus === "submitting" && "submitting…"}
              {approveStatus === "error"      && "retry approve"}
            </button>
            );
          })()}
          {approveStatus === "done" && address && tradeSession &&
            tradeSession.proxyAddress.toLowerCase() !== address.toLowerCase() && (
            <span className="text-[9px] text-[#a78bfa] px-1 border border-[#a78bfa]/20">approved</span>
          )}
        </>
      )}

      {/* EOA address */}
      <button
        onClick={handleDisconnect}
        className="text-[11px] px-1.5 py-px border border-[var(--border-subtle)] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors font-mono"
        title={`Wallet: ${address}\nProxy: ${resolvedProxy ?? proxyAddress ?? "unknown"}\nClick to disconnect`}
      >
        {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "wallet"}
      </button>

      {/* Proxy wallet address — shown after resolve or authorize */}
      {(() => {
        const px = resolvedProxy ?? proxyAddress;
        return px && px.toLowerCase() !== address?.toLowerCase() ? (
          <span
            className="text-[10px] font-mono text-[var(--text-faint)] border border-[var(--border-subtle)] px-1"
            title={`Polymarket proxy wallet: ${px}`}
          >
            {px.slice(0, 6)}…{px.slice(-4)}
          </span>
        ) : null;
      })()}
    </div>
  );
}
