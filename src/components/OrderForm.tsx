"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount, useChainId, useConnect, useSignTypedData, useReadContract, useWriteContract } from "wagmi";
import { polygon } from "wagmi/chains";
import { useWalletStore } from "@/stores/walletStore";
import { useToastStore } from "@/stores/toastStore";
import { authorizeTradeSession, lookupProxyWallet, saveTradeSession } from "@/lib/tradeAuth";

// Polymarket contract addresses on Polygon (from @polymarket/clob-client getContractConfig)
const EXCHANGE_ADDRESS       = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as const;
const NEG_RISK_EXCHANGE_ADDR = "0xC5d563A36AE78145C45a50134d48A1215220f80a" as const;
const USDC_ADDRESS           = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
const CTF_ADDRESS            = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const;

const BALANCE_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
] as const;

const CTF_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }] },
] as const;

const ERC20_ABI = [
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }] },
] as const;

// EIP-712 order types — matches ExchangeOrderBuilder.ORDER_STRUCTURE exactly
const ORDER_TYPES = {
  Order: [
    { name: "salt",          type: "uint256" },
    { name: "maker",         type: "address" },
    { name: "signer",        type: "address" },
    { name: "taker",         type: "address" },
    { name: "tokenId",       type: "uint256" },
    { name: "makerAmount",   type: "uint256" },
    { name: "takerAmount",   type: "uint256" },
    { name: "expiration",    type: "uint256" },
    { name: "nonce",         type: "uint256" },
    { name: "feeRateBps",    type: "uint256" },
    { name: "side",          type: "uint8"   },
    { name: "signatureType", type: "uint8"   },
  ],
} as const;

// Rounding helpers matching SDK's ROUNDING_CONFIG["0.01"]
const PRICE_DECIMALS = 2;
const SIZE_DECIMALS  = 2;
const USDC_DECIMALS  = 6;

function roundDown(n: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.floor(n * factor) / factor;
}
function roundNormal(n: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(n * factor) / factor;
}
function toUsdc(n: number): bigint {
  return BigInt(Math.round(n * 10 ** USDC_DECIMALS));
}

interface OrderFormProps {
  tokenId: string;
  currentPrice?: number; // 0–1
  outcomeName?: string;
  negRisk?: boolean;
  defaultSide?: "BUY" | "SELL";
  compact?: boolean; // inline / fused mode
}

type Side = "BUY" | "SELL";

export default function OrderForm({
  tokenId,
  currentPrice = 0.5,
  outcomeName = "YES",
  negRisk = false,
  defaultSide = "BUY",
  compact = false,
}: OrderFormProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors } = useConnect();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const { tradeSession, setTradeSession, setWallet, proxyAddress } = useWalletStore();
  const addTradeToast = useToastStore((s) => s.addTradeToast);

  const [side, setSide] = useState<Side>(defaultSide);
  const [price, setPrice] = useState(currentPrice.toFixed(2));
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "authorizing" | "approving" | "signing" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [minOrderShares, setMinOrderShares] = useState(5);

  useEffect(() => { setPrice(currentPrice.toFixed(2)); }, [currentPrice]);
  // Reset side and clear amount when the traded token changes
  useEffect(() => { setSide(defaultSide); setAmount(""); setStatus("idle"); setErrorMsg(null); }, [tokenId, defaultSide]);

  // Fetch market-specific minimum order size from CLOB (via orderbook API)
  useEffect(() => {
    if (!tokenId) return;
    fetch(`/api/orderbook?tokenId=${tokenId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { minimumOrderSize?: number } | null) => {
        if (d?.minimumOrderSize != null) setMinOrderShares(d.minimumOrderSize);
      })
      .catch(() => {/* keep default */});
  }, [tokenId]);

  const isPolygon = chainId === polygon.id;
  const priceNum  = parseFloat(price) || 0;
  const amountNum = parseFloat(amount) || 0;

  const rawPrice = roundNormal(priceNum, PRICE_DECIMALS);
  const estShares = side === "BUY"
    ? roundDown(amountNum / rawPrice, SIZE_DECIMALS)
    : roundDown(amountNum, SIZE_DECIMALS);

  const isEOA = !!address && !!proxyAddress && proxyAddress.toLowerCase() === address.toLowerCase();

  const balanceTarget = (proxyAddress ?? address) as `0x${string}` | undefined;
  const { data: usdcRawBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: BALANCE_ABI,
    functionName: "balanceOf",
    args: balanceTarget ? [balanceTarget] : undefined,
    query: { enabled: isConnected && isPolygon && !!balanceTarget && !compact, refetchInterval: 30_000 },
  });
  const usdcBalanceDisplay = usdcRawBalance !== undefined
    ? (Number(usdcRawBalance) / 1e6).toFixed(2)
    : null;

  const { data: allowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: balanceTarget ? [balanceTarget, negRisk ? NEG_RISK_EXCHANGE_ADDR : EXCHANGE_ADDRESS] : undefined,
    query: { enabled: isConnected && isPolygon && !!balanceTarget },
  });
  const spendUsdc = side === "BUY" ? amountNum : 0;
  const needsApproval = spendUsdc > 0 && allowance !== undefined && allowance < toUsdc(spendUsdc);

  const MIN_BUY_USDC = 1;
  const minSellShares = minOrderShares;
  const sizeTooSmall = amountNum > 0 && (
    side === "SELL" ? amountNum < minSellShares : amountNum < MIN_BUY_USDC
  );

  const { data: shareBalance, refetch: refetchShares } = useReadContract({
    address: CTF_ADDRESS,
    abi: CTF_ABI,
    functionName: "balanceOf",
    args: balanceTarget && tokenId ? [balanceTarget, BigInt(tokenId)] : undefined,
    query: { enabled: isConnected && isPolygon && !!balanceTarget && !!tokenId, refetchInterval: 15_000 },
  });
  const sharesHeld = shareBalance !== undefined ? Number(shareBalance) / 1e6 : null;

  const handleEOAApprove = useCallback(async () => {
    if (!address) return;
    const exchangeAddr = negRisk ? NEG_RISK_EXCHANGE_ADDR : EXCHANGE_ADDRESS;
    setStatus("approving");
    setErrorMsg(null);
    try {
      await writeContractAsync({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [exchangeAddr, BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")],
      });
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "approval failed");
    }
  }, [address, negRisk, writeContractAsync]);

  const handleConnect = useCallback(() => {
    const injector = connectors.find((c) => c.id === "injected") ?? connectors[0];
    if (injector) connect({ connector: injector });
  }, [connect, connectors]);

  const handleAuthorize = useCallback(async () => {
    if (!address) return;
    setStatus("authorizing");
    setErrorMsg(null);
    try {
      const proxyAddr = await lookupProxyWallet(address).catch((e: unknown) => {
        if (e instanceof Error && e.message === "PROXY_NOT_FOUND") return address;
        throw e;
      });
      const session = await authorizeTradeSession(address, proxyAddr, signTypedDataAsync);
      setTradeSession(session);
      setWallet(address, chainId);
      saveTradeSession(address, session);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "authorization failed");
    }
  }, [address, signTypedDataAsync, setTradeSession, setWallet, chainId]);

  // Accept optional overrides so compact BUY/SELL buttons can bypass async setSide
  const handlePlaceOrder = useCallback(async (sideParam?: Side, amountOverride?: number) => {
    const effectiveSide = sideParam ?? side;
    const effectiveAmount = amountOverride ?? amountNum;
    if (!tradeSession || !address || priceNum <= 0 || effectiveAmount <= 0) return;
    setStatus("signing");
    setErrorMsg(null);
    setOrderId(null);
    try {
      const exchangeAddr = negRisk ? NEG_RISK_EXCHANGE_ADDR : EXCHANGE_ADDRESS;
      const rawSz  = roundDown(effectiveSide === "BUY" ? effectiveAmount / rawPrice : effectiveAmount, SIZE_DECIMALS);
      const rawPr  = rawPrice;
      const makerAmt = effectiveSide === "BUY" ? toUsdc(roundDown(rawSz * rawPr, 4)) : toUsdc(rawSz);
      const takerAmt = effectiveSide === "BUY" ? toUsdc(rawSz)                        : toUsdc(roundDown(rawSz * rawPr, 4));
      const salt = BigInt(Math.floor(Math.random() * 1e15));
      const proxy = (proxyAddress ?? address) as `0x${string}`;
      const eoa   = address as `0x${string}`;
      const isEOAOrder = proxy.toLowerCase() === eoa.toLowerCase();
      const sigType = isEOAOrder ? 0 : 2;
      const orderMessage = {
        salt, maker: proxy, signer: eoa,
        taker: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        tokenId: BigInt(tokenId),
        makerAmount: makerAmt, takerAmount: takerAmt,
        expiration: BigInt(0), nonce: BigInt(0), feeRateBps: BigInt(0),
        side: effectiveSide === "BUY" ? 0 : 1,
        signatureType: sigType,
      } as const;
      const domain = {
        name: "Polymarket CTF Exchange", version: "1",
        chainId: polygon.id, verifyingContract: exchangeAddr,
      } as const;
      const signature = await signTypedDataAsync({ domain, types: ORDER_TYPES, primaryType: "Order", message: orderMessage });
      setStatus("submitting");
      addTradeToast("submitting", "submitting…", `${effectiveSide} ${outcomeName}`, `$${effectiveAmount.toFixed(2)} @ $${rawPrice.toFixed(2)}`);
      const signedOrder = {
        salt: salt.toString(), maker: proxy, signer: eoa,
        taker: "0x0000000000000000000000000000000000000000",
        tokenId, makerAmount: makerAmt.toString(), takerAmount: takerAmt.toString(),
        expiration: "0", nonce: "0", feeRateBps: "0",
        side: effectiveSide === "BUY" ? 0 : 1,
        signatureType: sigType, signature,
      };
      const res = await fetch("/api/trade/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedOrder, sessionToken: tradeSession.sessionToken }),
      });
      const data = await res.json();
      console.log("[OrderForm] order response:", data);
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      const oid = typeof data.orderId === "string" ? data.orderId : data.status ?? "submitted";
      setOrderId(oid);
      setStatus("done");
      setAmount("");
      void refetchShares();
      addTradeToast(
        "success",
        data.status === "matched" ? "order matched" : "order placed",
        `${effectiveSide} ${outcomeName}`,
        oid && oid !== "submitted" ? oid.slice(0, 18) + "…" : undefined,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "order failed";
      setStatus("error");
      setErrorMsg(msg);
      addTradeToast("error", "order failed", `${effectiveSide} ${outcomeName}`, msg.slice(0, 60));
    }
  }, [tradeSession, address, proxyAddress, priceNum, rawPrice, side, amountNum, tokenId, negRisk, signTypedDataAsync, refetchShares, outcomeName, addTradeToast]);

  const busy = ["authorizing", "approving", "signing", "submitting"].includes(status);

  // ─── COMPACT MODE ────────────────────────────────────────────────────────────
  if (compact) {
    if (!isConnected) return (
      <button onClick={handleConnect} className="text-[9px] px-1.5 py-px border border-[#22c55e]/30 text-[#22c55e] hover:border-[#22c55e]/60 transition-colors">
        connect wallet
      </button>
    );
    if (!isPolygon) return (
      <span className="text-[9px] text-[#f59e0b]">switch to Polygon</span>
    );
    if (!tradeSession) return (
      <button onClick={handleAuthorize} disabled={busy} className="text-[9px] px-1.5 py-px border border-[#f59e0b]/40 text-[#f59e0b] hover:border-[#f59e0b]/70 transition-colors disabled:opacity-40">
        {status === "authorizing" ? "authorizing…" : "authorize to trade"}
      </button>
    );
    if (needsApproval) return isEOA ? (
      <button onClick={handleEOAApprove} disabled={busy} className="text-[9px] px-1.5 py-px border border-[#f59e0b]/40 text-[#f59e0b] hover:border-[#f59e0b]/70 transition-colors disabled:opacity-40">
        {status === "approving" ? "approving…" : "approve USDC"}
      </button>
    ) : (
      <span className="text-[9px] text-[#f59e0b]">approve tokens in header first</span>
    );

    const buyEstShares = roundDown(amountNum / rawPrice, SIZE_DECIMALS);
    const isBuyTooSmall = amountNum > 0 && amountNum < MIN_BUY_USDC;

    return (
      <div className="flex items-center gap-1.5 flex-wrap font-mono">
        {/* Amount input */}
        <div className="flex items-center gap-0.5">
          <span className="text-[9px] text-[var(--text-faint)]">$</span>
          <input
            type="number" min="0" step="1" placeholder="0" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-12 bg-transparent border border-[var(--border)] px-1 py-0 text-[10px] tabular-nums text-right text-[var(--text)] outline-none focus:border-[#22c55e]/40"
          />
        </div>
        {/* Price input */}
        <div className="flex items-center gap-0.5">
          <span className="text-[9px] text-[var(--text-faint)]">@</span>
          <input
            type="number" min="0.01" max="0.99" step="0.01" value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-10 bg-transparent border border-[var(--border)] px-1 py-0 text-[10px] tabular-nums text-right text-[var(--text)] outline-none focus:border-[#22c55e]/40"
          />
        </div>
        {/* Shares estimate */}
        {amountNum > 0 && priceNum > 0 && !isBuyTooSmall && (
          <span className="text-[9px] text-[var(--text-faint)] tabular-nums">→{buyEstShares.toFixed(1)}sh</span>
        )}
        {isBuyTooSmall && <span className="text-[9px] text-[#f59e0b]">min $1</span>}
        {/* BUY button */}
        <button
          onClick={() => handlePlaceOrder("BUY")}
          disabled={busy || amountNum <= 0 || priceNum <= 0 || isBuyTooSmall}
          className="text-[9px] px-1.5 py-px border border-[#22c55e]/40 text-[#22c55e] hover:border-[#22c55e]/70 hover:bg-[#22c55e]/5 transition-colors disabled:opacity-40"
        >
          {status === "signing" || status === "submitting" ? "…" : "BUY"}
        </button>
        {/* SELL button — only if holding shares */}
        {sharesHeld !== null && sharesHeld > 0.01 && (
          <button
            onClick={() => handlePlaceOrder("SELL", sharesHeld)}
            disabled={busy}
            className="text-[9px] px-1.5 py-px border border-[#ff4444]/40 text-[#ff4444] hover:border-[#ff4444]/70 hover:bg-[#ff4444]/5 transition-colors disabled:opacity-40"
            title={`Sell all ${sharesHeld.toFixed(2)} shares`}
          >
            {busy && side === "SELL" ? "…" : `SELL ${sharesHeld.toFixed(1)}sh`}
          </button>
        )}
        {/* Status */}
        {status === "done" && <span className="text-[9px] text-[#22c55e]">✓</span>}
        {status === "error" && errorMsg && (
          <span className="text-[9px] text-[#ff4444] max-w-[100px] truncate" title={errorMsg}>{errorMsg}</span>
        )}
      </div>
    );
  }

  // ─── FULL MODE ───────────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="border border-[var(--border-subtle)] rounded-sm px-3 py-3 text-[11px]">
        <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-2">trade</div>
        <button onClick={handleConnect} className="w-full text-center py-1.5 border border-[#22c55e]/30 text-[#22c55e] hover:border-[#22c55e]/60 transition-colors text-[11px]">
          connect wallet
        </button>
      </div>
    );
  }

  if (!isPolygon) {
    return (
      <div className="border border-[var(--border-subtle)] rounded-sm px-3 py-3 text-[11px]">
        <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-2">trade</div>
        <div className="text-[#f59e0b] text-[10px]">switch wallet to Polygon network to trade</div>
      </div>
    );
  }

  return (
    <div className="border border-[var(--border-subtle)] rounded-sm px-3 py-3 text-[11px] font-mono">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)]">trade</span>
        <div className="flex items-center gap-1.5">
          {usdcBalanceDisplay !== null && (
            <span className="text-[10px] tabular-nums text-[var(--text-muted)]" title="Your USDC.e balance">
              bal: <span className="text-[var(--text-dim)]">${usdcBalanceDisplay}</span>
            </span>
          )}
          {sharesHeld !== null && sharesHeld > 0 && (
            <button
              onClick={() => { setSide("SELL"); setAmount(sharesHeld.toFixed(2)); }}
              className="text-[10px] tabular-nums text-[#a78bfa] hover:text-[#c4b5fd] transition-colors"
              title="Click to sell all shares"
            >
              {sharesHeld.toFixed(2)} shares
            </button>
          )}
          {negRisk && <span className="text-[9px] text-[var(--text-ghost)] border border-[var(--border-subtle)] px-1">neg-risk</span>}
        </div>
      </div>

      {/* Side selector */}
      <div className="flex gap-1 mb-2">
        {(["BUY", "SELL"] as Side[]).map((s) => (
          <button key={s} onClick={() => setSide(s)}
            className={`flex-1 py-1 text-[10px] border transition-colors ${
              side === s
                ? s === "BUY" ? "border-[#22c55e]/60 text-[#22c55e] bg-[#22c55e]/10" : "border-[#ff4444]/60 text-[#ff4444] bg-[#ff4444]/10"
                : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {s} {outcomeName}
          </button>
        ))}
      </div>

      {/* Price */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[var(--text-muted)] w-14 shrink-0">Price</span>
        <input type="number" min="0.01" max="0.99" step="0.01" value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="flex-1 bg-transparent border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--text)] tabular-nums" />
        <span className="text-[var(--text-faint)] text-[10px]">USDC</span>
      </div>

      {/* Amount */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[var(--text-muted)] w-14 shrink-0">{side === "BUY" ? "Spend" : "Shares"}</span>
        <input type="number" min="0" step="1" placeholder="0" value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="flex-1 bg-transparent border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--text)] tabular-nums" />
        <span className="text-[var(--text-faint)] text-[10px]">{side === "BUY" ? "USDC" : "shares"}</span>
      </div>

      {/* Preview */}
      {amountNum > 0 && priceNum > 0 && (
        <div className="text-[10px] mb-2 tabular-nums">
          {sizeTooSmall ? (
            <span className="text-[#f59e0b]">
              {side === "BUY" ? `min $${MIN_BUY_USDC} USDC` : `min ${minSellShares} shares`}
            </span>
          ) : side === "BUY" ? (
            <span className="text-[var(--text-muted)]">get ~<span className="text-[var(--text-dim)]">{estShares.toFixed(2)}</span> shares</span>
          ) : (
            <span className="text-[var(--text-muted)]">receive ~<span className="text-[var(--text-dim)]">{(estShares * rawPrice).toFixed(2)}</span> USDC</span>
          )}
        </div>
      )}

      {/* Action button */}
      {!tradeSession ? (
        <button onClick={handleAuthorize} disabled={busy}
          className="w-full py-1.5 border border-[#f59e0b]/40 text-[#f59e0b] hover:border-[#f59e0b]/70 transition-colors text-[10px] disabled:opacity-40">
          {status === "authorizing" ? "authorizing…" : "authorize trading"}
        </button>
      ) : needsApproval ? (
        isEOA ? (
          <button onClick={handleEOAApprove} disabled={busy}
            className="w-full py-1.5 border border-[#f59e0b]/40 text-[#f59e0b] hover:border-[#f59e0b]/70 transition-colors text-[10px] disabled:opacity-40">
            {status === "approving" ? "approving…" : "approve USDC"}
          </button>
        ) : (
          <div className="w-full py-1.5 text-center text-[10px] text-[#f59e0b] border border-[#f59e0b]/30">
            click &quot;approve tokens&quot; in header first
          </div>
        )
      ) : (
        <button onClick={() => handlePlaceOrder()} disabled={busy || amountNum <= 0 || priceNum <= 0 || sizeTooSmall}
          className={`w-full py-1.5 border transition-colors text-[10px] disabled:opacity-40 ${
            side === "BUY"
              ? "border-[#22c55e]/40 text-[#22c55e] hover:border-[#22c55e]/70 hover:bg-[#22c55e]/5"
              : "border-[#ff4444]/40 text-[#ff4444] hover:border-[#ff4444]/70 hover:bg-[#ff4444]/5"
          }`}>
          {status === "signing"    ? "sign in wallet…" :
           status === "submitting" ? "submitting…"     :
           `place ${side.toLowerCase()} order`}
        </button>
      )}

      {status === "done" && (
        <div className="mt-1.5 text-[10px] text-[#22c55e]">
          ✓ order placed{orderId && orderId !== "submitted" ? <> · <span className="font-mono">{orderId.slice(0, 16)}…</span></> : ""}
        </div>
      )}
      {status === "error" && errorMsg && (
        <div className="mt-1.5 text-[10px] text-[#ff4444] break-all">{errorMsg}</div>
      )}
    </div>
  );
}
