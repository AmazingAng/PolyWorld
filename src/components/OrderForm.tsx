"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useI18n } from "@/i18n";
import { useAccount, useConnect, useSignTypedData, useReadContract, useWalletClient, useWriteContract } from "wagmi";
import { polygon } from "wagmi/chains";
import { useWalletStore } from "@/stores/walletStore";
import { useToastStore } from "@/stores/toastStore";
import { authorizeTradeSession, lookupProxyWallet, saveTradeSession, setApprovedFlag } from "@/lib/tradeAuth";
import { useSignMessage } from "wagmi";
import type { MarketSide } from "@/lib/marketOrder";
import { roundDown } from "@/lib/tradeAmounts";
import { fetchOpenOrders, type OpenOrder } from "@/lib/openOrders";
import { Chain, ClobClient, OrderType as ClobOrderType, Side as ClobSide, SignatureType } from "@polymarket/clob-client";

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
  { name: "isApprovedForAll", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "operator", type: "address" }],
    outputs: [{ name: "", type: "bool" }] },
] as const;

const ERC20_ABI = [
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }] },
] as const;

const SIZE_DECIMALS = 2;
const USDC_DECIMALS  = 6;
const REQUEST_TIMEOUT_MS = 15_000;

function roundNormal(n: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(n * factor) / factor;
}
function toUsdc(n: number): bigint {
  return BigInt(Math.round(n * 10 ** USDC_DECIMALS));
}

async function fetchJsonWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(input, { ...init, signal });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function notifyHeaderBalanceRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("polyworld:refresh-header-balance"));
  }
}

function humanizeError(msg: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const m = msg.toLowerCase();
  if (m.includes("user rejected") || m.includes("user denied") || m.includes("rejected by user")) return t("trade.userCancelled");
  if (m.includes("insufficient funds") || m.includes("insufficient balance")) return t("trade.insufficientUsdc");
  if (m.includes("not enough balance") || m.includes("allowance")) return t("trade.tokenApprovalMissing");
  if (m.includes("execution reverted")) return t("trade.orderRejected");
  if (m.includes("nonce") || m.includes("already known")) return t("trade.duplicateOrder");
  if (m.includes("geo") || m.includes("restricted") || m.includes("unavailable in your region")) return t("trade.regionRestricted");
  if (m.includes("network") || m.includes("fetch") || m.includes("failed to fetch")) return t("trade.networkError");
  if (m.includes("401") || m.includes("unauthorized") || m.includes("session")) return t("trade.sessionExpired");
  if (m.includes("min order") || m.includes("minimum")) return t("trade.orderTooSmall");
  if (m.includes("timeout")) return t("trade.requestTimeout");
  // Keep message but strip long hex strings
  return msg.replace(/0x[0-9a-f]{20,}/gi, "…").slice(0, 80);
}

/** Check Polymarket geo-restriction directly from the browser.
 *  Must be called from client so Polymarket sees the user's real IP.
 *  @see https://docs.polymarket.com/api-reference/geoblock */
async function checkGeoBlock(): Promise<{ blocked: boolean; country?: string }> {
  try {
    const res = await fetch("https://polymarket.com/api/geoblock", {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { blocked: false };
    const data = await res.json();
    return { blocked: data?.blocked === true, country: data?.country };
  } catch {
    return { blocked: false };
  }
}

interface OrderFormProps {
  tokenId: string;
  currentPrice?: number; // 0–1
  outcomeName?: string;
  negRisk?: boolean;
  defaultSide?: "BUY" | "SELL";
  compact?: boolean; // inline / fused mode
  autoFocusAmount?: boolean;
  onSuccess?: (info: { side: string; amount: number; price: number }) => void;
}

type Side = "BUY" | "SELL";

export default function OrderForm({
  tokenId,
  currentPrice = 0.5,
  outcomeName = "YES",
  negRisk = false,
  defaultSide = "BUY",
  compact = false,
  autoFocusAmount = false,
  onSuccess,
}: OrderFormProps) {
  const { t } = useI18n();
  const amountInputRef = useRef<HTMLInputElement>(null);
  const BUY_PRESETS = [5, 50, 100, 500] as const;
  const SELL_PRESETS = [10, 25, 50, 100] as const;
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { signTypedDataAsync } = useSignTypedData();
  const { signMessageAsync } = useSignMessage();
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();

  const { tradeSession, setTradeSession, setWallet, proxyAddress } = useWalletStore();
  const addTradeToast = useToastStore((s) => s.addTradeToast);

  const [side, setSide] = useState<Side>(defaultSide);
  const [price, setPrice] = useState(currentPrice.toFixed(2));
  const [amount, setAmount] = useState("");
  const [limitOnly, setLimitOnly] = useState(false);
  const isMarketOrder = !limitOnly;
  const [status, setStatus] = useState<"idle" | "authorizing" | "approving" | "signing" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [minOrderShares, setMinOrderShares] = useState(5);
  const [tickSize, setTickSize] = useState(0.01);
  const [optimisticSharesHeld, setOptimisticSharesHeld] = useState<number | null>(null);
  const [ctfApprovalFallback, setCtfApprovalFallback] = useState(false);
  const [quotedMarketPrice, setQuotedMarketPrice] = useState<number | null>(null);   // execution price (display)
  const [quotedLimitPrice, setQuotedLimitPrice] = useState<number | null>(null);     // buffered limit price (order submission)
  const quotedAtRef = useRef<number | null>(null);
  const [quoteRefreshKey, setQuoteRefreshKey] = useState(0);

  const priceDecimals = useMemo(() => tickSize <= 0.001 ? 3 : tickSize <= 0.01 ? 2 : 1, [tickSize]);
  const centsStep = useMemo(() => tickSize * 100, [tickSize]);
  const centsDecimals = useMemo(() => Math.max(0, priceDecimals - 2), [priceDecimals]);
  const minPrice = tickSize;
  const maxPrice = 1 - tickSize;

  useEffect(() => { setPrice(currentPrice.toFixed(priceDecimals)); }, [currentPrice, priceDecimals]);
  // Reset state when the traded token changes; also clear stale orderbook prices
  useEffect(() => {
    setSide(defaultSide); setAmount(""); setStatus("idle"); setErrorMsg(null); setCtfApprovalFallback(false);
  }, [tokenId, defaultSide]);

  // Fetch market-specific minimum order size from CLOB (via orderbook API)
  useEffect(() => {
    if (!tokenId) return;
    fetch(`/api/orderbook?tokenId=${tokenId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { minimumOrderSize?: number; feeRateBps?: number; tickSize?: number } | null) => {
        if (d?.minimumOrderSize != null) setMinOrderShares(d.minimumOrderSize);
        if (d?.tickSize != null && d.tickSize > 0) setTickSize(d.tickSize);
      })
      .catch(() => {/* keep default */});
  }, [tokenId]);

  // chainId from useAccount() may be undefined briefly after connect; trust walletStore as fallback
  const storeChainId = useWalletStore((s) => s.chainId);
  const effectiveChainId = chainId ?? storeChainId;
  const isPolygon = effectiveChainId === polygon.id;
  const priceNum  = parseFloat(price) || 0;
  const amountNum = parseFloat(amount) || 0;

  // Focus the amount input on mount when requested (e.g. from TradeModal)
  useEffect(() => {
    if (autoFocusAmount && amountInputRef.current) {
      amountInputRef.current.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run only on mount

  // Debounced market-price pre-fetch for slippage hint
  // (placed after amountNum so it can be referenced in the dependency array)
  useEffect(() => {
    if (!isMarketOrder || amountNum <= 0) { setQuotedMarketPrice(null); setQuotedLimitPrice(null); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/trade/market-price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenId, side, amount: amountNum }),
        });
        if (!res.ok) return;
        const data = await res.json() as { executionPrice?: number; limitPrice?: number };
        if (typeof data.executionPrice === "number") {
          setQuotedMarketPrice(data.executionPrice);
          setQuotedLimitPrice(data.limitPrice ?? data.executionPrice);
          quotedAtRef.current = Date.now();
        }
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [isMarketOrder, amountNum, tokenId, side, quoteRefreshKey]);

  const rawPrice = roundNormal(priceNum, priceDecimals);

  const isEOA = !!address && !!proxyAddress && proxyAddress.toLowerCase() === address.toLowerCase();

  const balanceTarget = (proxyAddress ?? address) as `0x${string}` | undefined;

  const { data: usdcRawBalance, refetch: refetchUsdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: BALANCE_ABI,
    functionName: "balanceOf",
    args: balanceTarget ? [balanceTarget] : undefined,
    chainId: polygon.id,
    query: { enabled: isConnected && isPolygon && !!balanceTarget, refetchInterval: 15_000 },
  });
  const usdcBalanceDisplay = usdcRawBalance !== undefined
    ? (Number(usdcRawBalance) / 1e6).toFixed(2)
    : null;

  const { data: allowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: balanceTarget ? [balanceTarget, negRisk ? NEG_RISK_EXCHANGE_ADDR : EXCHANGE_ADDRESS] : undefined,
    chainId: polygon.id,
    query: { enabled: isConnected && isPolygon && !!balanceTarget, refetchInterval: false },
  });
  const spendUsdc = side === "BUY" ? amountNum : 0;
  const needsApproval = spendUsdc > 0 && allowance !== undefined && allowance < toUsdc(spendUsdc);

  // For SELL: CTF ERC1155 must have operator approval for the exchange
  const { data: ctfApproved } = useReadContract({
    address: CTF_ADDRESS,
    abi: CTF_ABI,
    functionName: "isApprovedForAll",
    args: balanceTarget ? [balanceTarget, negRisk ? NEG_RISK_EXCHANGE_ADDR : EXCHANGE_ADDRESS] : undefined,
    chainId: polygon.id,
    query: { enabled: isConnected && isPolygon && !!balanceTarget && side === "SELL" },
  });
  const needsCTFApproval = side === "SELL" && ctfApproved === false;

  const MIN_BUY_USDC = 1;
  const minSellShares = minOrderShares;
  const usdcBalance = usdcRawBalance !== undefined ? Number(usdcRawBalance) / 1e6 : null;
  const sizeTooSmall = amountNum > 0 && (
    side === "SELL" ? amountNum < minSellShares : amountNum < MIN_BUY_USDC
  );
  const { data: shareBalance, refetch: refetchShares } = useReadContract({
    address: CTF_ADDRESS,
    abi: CTF_ABI,
    functionName: "balanceOf",
    args: balanceTarget && tokenId ? [balanceTarget, BigInt(tokenId)] : undefined,
    chainId: polygon.id,
    query: { enabled: isConnected && isPolygon && !!balanceTarget && !!tokenId, refetchInterval: 15_000 },
  });
  const sharesHeld = shareBalance !== undefined ? Number(shareBalance) / 1e6 : null;

  // Shares/USDC locked in existing open orders for this token — not available for new orders
  const [lockedShares, setLockedShares] = useState(0);
  const [lockedUsdc, setLockedUsdc] = useState(0);
  useEffect(() => {
    if (!tradeSession?.sessionToken || !tokenId) { setLockedShares(0); setLockedUsdc(0); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const orders = await fetchOpenOrders(tradeSession.sessionToken);
        let sellLocked = 0;
        let buyLocked = 0;
        for (const o of orders) {
          const remaining = (parseFloat(o.original_size) || 0) - (parseFloat(o.size_matched) || 0);
          if (remaining <= 0) continue;
          if (o.asset_id === tokenId && o.side === "SELL") {
            sellLocked += remaining;
          }
          if (o.side === "BUY") {
            buyLocked += remaining * (parseFloat(o.price) || 0);
          }
        }
        if (!cancelled) { setLockedShares(sellLocked); setLockedUsdc(buyLocked); }
      } catch { /* ignore */ }
    };
    void load();
    const onOrderPlaced = () => { void load(); };
    window.addEventListener("polyworld:order-placed", onOrderPlaced);
    return () => { cancelled = true; window.removeEventListener("polyworld:order-placed", onOrderPlaced); };
  }, [tradeSession?.sessionToken, tokenId]);

  const availableUsdc = usdcBalance !== null ? Math.max(0, usdcBalance - lockedUsdc) : null;
  const exceedsBalance = side === "BUY" && amountNum > 0 && availableUsdc !== null && amountNum > availableUsdc;
  const availableShares = sharesHeld !== null ? Math.max(0, sharesHeld - lockedShares) : null;
  const displayedSharesHeld = optimisticSharesHeld ?? availableShares;
  const exceedsShares = side === "SELL" && amountNum > 0 && displayedSharesHeld !== null && amountNum > displayedSharesHeld;

  useEffect(() => {
    if (optimisticSharesHeld === null || sharesHeld === null) return;
    if (Math.abs(sharesHeld - optimisticSharesHeld) < 0.02) {
      setOptimisticSharesHeld(null);
    }
  }, [optimisticSharesHeld, sharesHeld]);

  const refreshTradeState = useCallback(async () => {
    const delays = [500, 2000, 5000];
    notifyHeaderBalanceRefresh();
    await Promise.allSettled([refetchShares(), refetchUsdcBalance()]);
    for (const delay of delays) {
      await sleep(delay);
      notifyHeaderBalanceRefresh();
      await Promise.allSettled([refetchShares(), refetchUsdcBalance()]);
    }
  }, [refetchShares, refetchUsdcBalance]);

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
      setErrorMsg(humanizeError(e instanceof Error ? e.message : "approval failed", t));
    }
  }, [address, negRisk, writeContractAsync, t]);

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
      if (chainId) setWallet(address, chainId);
      saveTradeSession(address, session);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErrorMsg(humanizeError(e instanceof Error ? e.message : "authorization failed", t));
    }
  }, [address, signTypedDataAsync, setTradeSession, setWallet, chainId, t]);

  // Accept optional overrides so compact BUY/SELL buttons can bypass async setSide
  // marketOrder=true → FOK with extreme price (0.999 buy / 0.001 sell)
  const handlePlaceOrder = useCallback(async (sideParam?: Side, amountOverride?: number, marketOrder = false) => {
    const effectiveSide = sideParam ?? side;
    const effectiveAmount = amountOverride ?? amountNum;
    if (!tradeSession || !address || effectiveAmount <= 0) return;
    const traceId = `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = performance.now();
    setStatus("signing");
    setErrorMsg(null);
    setOrderId(null);
    try {
      let effectivePrice = priceNum;
      if (process.env.NODE_ENV !== "production") {
        console.log("[OrderForm] placeOrder:start", { traceId, marketOrder, tokenId, side: effectiveSide, amount: effectiveAmount, inputPrice: priceNum, proxyAddress, address });
      }
      if (marketOrder) {
        const quoteRes = await fetchJsonWithTimeout("/api/trade/market-price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tokenId,
            side: effectiveSide as MarketSide,
            amount: effectiveAmount,
          }),
        });
        const quoteData = await quoteRes.json() as { executionPrice?: number; limitPrice?: number; error?: string };
        if (process.env.NODE_ENV !== "production") {
          console.log("[OrderForm] placeOrder:marketQuote", { traceId, ok: quoteRes.ok, status: quoteRes.status, quoteData });
        }
        if (!quoteRes.ok || typeof quoteData.limitPrice !== "number") {
          throw new Error(quoteData.error ?? `HTTP ${quoteRes.status}`);
        }
        effectivePrice = quoteData.limitPrice;  // submit with buffered limit price
        setQuotedMarketPrice(quoteData.executionPrice ?? quoteData.limitPrice);  // display execution price
        setQuotedLimitPrice(quoteData.limitPrice);
        quotedAtRef.current = Date.now();
      } else if (priceNum <= 0) {
        return;
      }

      const exchangeAddr = negRisk ? NEG_RISK_EXCHANGE_ADDR : EXCHANGE_ADDRESS;
      const orderPr = roundNormal(effectivePrice, priceDecimals);
      const rawSz  = roundDown(effectiveSide === "BUY" ? effectiveAmount / orderPr : effectiveAmount, 2);
      const proxy = (proxyAddress ?? address) as `0x${string}`;
      const eoa   = address as `0x${string}`;
      const isEOAOrder = proxy.toLowerCase() === eoa.toLowerCase();
      const sigType = isEOAOrder ? SignatureType.EOA : SignatureType.POLY_GNOSIS_SAFE;
      if (!walletClient) {
        throw new Error("wallet client unavailable");
      }
      const signingClient = new ClobClient(
        "https://clob.polymarket.com",
        Chain.POLYGON,
        walletClient,
        undefined,
        sigType,
        proxy,
      );
      const signedOrder = marketOrder
        ? await signingClient.createMarketOrder(
            {
              tokenID: tokenId,
              side: effectiveSide === "BUY" ? ClobSide.BUY : ClobSide.SELL,
              amount: effectiveAmount,
              price: orderPr,
              orderType: ClobOrderType.FAK,
            },
            { negRisk },
          )
        : await signingClient.createOrder(
            {
              tokenID: tokenId,
              side: effectiveSide === "BUY" ? ClobSide.BUY : ClobSide.SELL,
              price: orderPr,
              size: rawSz,
            },
            { negRisk },
          );
      if (process.env.NODE_ENV !== "production") {
        console.log("[OrderForm] placeOrder:signingPayload", {
          traceId,
          exchangeAddr,
          orderPrice: orderPr,
          rawSize: rawSz,
          makerAmount: signedOrder.makerAmount,
          takerAmount: signedOrder.takerAmount,
          feeRateBps: signedOrder.feeRateBps,
          proxy,
          eoa,
          sigType,
          isEOAOrder,
        });
      }
      setStatus("submitting");
      addTradeToast("submitting", "submitting…", `${effectiveSide} ${outcomeName}`, `$${effectiveAmount.toFixed(2)}${marketOrder ? " market" : ` @ $${orderPr.toFixed(2)}`}`, traceId);
      if (process.env.NODE_ENV !== "production") {
        console.log("[OrderForm] placeOrder:submit", { traceId, signedOrder: { maker: signedOrder.maker, signer: signedOrder.signer, tokenId: signedOrder.tokenId, makerAmount: signedOrder.makerAmount, takerAmount: signedOrder.takerAmount, side: signedOrder.side } });
      }
      const res = await fetch("/api/trade/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({ signedOrder, sessionToken: tradeSession.sessionToken, marketOrder, traceId }),
      });
      const data = await res.json();
      if (process.env.NODE_ENV !== "production") {
        console.log("[OrderForm] placeOrder:response", { traceId, ok: res.ok, status: res.status, elapsedMs: Math.round(performance.now() - startedAt), data });
      }
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      const oid = typeof data.orderId === "string" ? data.orderId : data.status ?? "submitted";
      const finalStatus = typeof data.status === "string" ? data.status : "submitted";
      if (process.env.NODE_ENV !== "production") {
        console.log("[OrderForm] placeOrder:resultSummary", { traceId, finalStatus, orderId: oid });
      }
      if (finalStatus === "unmatched") {
        // FOK market order was accepted but not filled (no liquidity at this price).
        setStatus("error");
        setErrorMsg(t("trade.noLiquidity"));
        addTradeToast("error", t("trade.orderNotFilled"), `${effectiveSide} ${outcomeName}`, t("trade.noLiquidityShort"), traceId);
        return;
      }
      setOrderId(oid);
      setStatus("done");
      setAmount("");
      if (finalStatus === "matched") {
        const optimisticShareDelta = effectiveSide === "BUY"
          ? Number(signedOrder.takerAmount) / 1e6
          : -(Number(signedOrder.makerAmount) / 1e6);
        if (sharesHeld !== null) {
          setOptimisticSharesHeld(Math.max(0, roundDown(sharesHeld + optimisticShareDelta, SIZE_DECIMALS)));
          setTimeout(() => setOptimisticSharesHeld(null), 15_000);
        }
      }
      void refreshTradeState();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("polyworld:order-placed"));
      }
      addTradeToast(
        "success",
        finalStatus === "matched" ? t("trade.orderMatched") : t("trade.orderPlaced"),
        `${effectiveSide} ${outcomeName}`,
        oid && oid !== "submitted" ? oid.slice(0, 18) + "…" : undefined,
        traceId,
      );
      onSuccess?.({ side: effectiveSide, amount: effectiveAmount, price: effectivePrice });
    } catch (e) {
      const raw = e instanceof Error
        ? e.message
        : (e !== null && typeof e === "object" && "message" in e)
          ? String((e as { message: unknown }).message)
          : typeof e === "string"
            ? e
            : t("trade.orderFailed");
      const isUserRejection = /user rejected|user denied|rejected by user|user cancelled/i.test(raw)
        || (e !== null && typeof e === "object" && "code" in e && (e as { code: unknown }).code === 4001);
      if (isUserRejection) {
        // User cancelled the wallet signature — not an error, just reset silently
        setStatus("idle");
        setErrorMsg(null);
        return;
      }
      console.error("[OrderForm] placeOrder:error", {
        traceId,
        elapsedMs: Math.round(performance.now() - startedAt),
        raw,
        cause: e,
      });
      // If CLOB rejects SELL with balance/allowance error, CTF approval is likely missing.
      // Surface the "Approve & Sell" button instead of a generic error.
      const isBalanceAllowanceError = effectiveSide === "SELL"
        && (raw.toLowerCase().includes("not enough balance") || raw.toLowerCase().includes("allowance"));
      if (isBalanceAllowanceError) {
        setCtfApprovalFallback(true);
        setStatus("error");
        setErrorMsg(t("trade.tokenApprovalRequired"));
        return;
      }
      const isNetworkError = /network|fetch|failed to fetch/i.test(raw);
      if (isNetworkError) {
        // Probe Polymarket geoblock API to distinguish geo-block from real network failure
        const geo = await checkGeoBlock();
        if (geo.blocked) {
          const geoMsg = t("trade.geoRestricted", { country: geo.country ? ` (${geo.country})` : "" });
          setStatus("error");
          setErrorMsg(geoMsg);
          addTradeToast("error", "geo-restricted", `${effectiveSide} ${outcomeName}`, geoMsg.slice(0, 60), traceId);
          return;
        }
      }
      const msg = humanizeError(raw, t);
      setStatus("error");
      setErrorMsg(msg);
      addTradeToast("error", t("trade.orderFailed"), `${effectiveSide} ${outcomeName}`, msg.slice(0, 60), traceId);
    }
  }, [tradeSession, address, proxyAddress, priceNum, side, amountNum, tokenId, negRisk, walletClient, refreshTradeState, outcomeName, addTradeToast, sharesHeld, onSuccess, priceDecimals, t]);

  // For SELL: approve CTF operator (proxy via Safe relayer, or EOA via writeContract) then place order
  const handleApproveCTFAndSell = useCallback(async () => {
    if (!tradeSession || !address) return;
    const exchangeAddr = negRisk ? NEG_RISK_EXCHANGE_ADDR : EXCHANGE_ADDRESS;
    const proxy = (proxyAddress ?? address) as `0x${string}`;
    const isEOAOrder = proxy.toLowerCase() === address.toLowerCase();
    setStatus("approving");
    setErrorMsg(null);
    try {
      if (isEOAOrder) {
        // EOA: direct on-chain setApprovalForAll
        await writeContractAsync({
          address: CTF_ADDRESS,
          abi: CTF_ABI,
          functionName: "setApprovalForAll",
          args: [exchangeAddr, true],
        });
      } else {
        // Proxy (Gnosis Safe): use Polymarket relayer
        const prepRes = await fetch("/api/trade/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken: tradeSession.sessionToken, prepare: true }),
        });
        const prepData = await prepRes.json() as { hash: `0x${string}`; nonce: string; error?: string };
        if (!prepRes.ok || prepData.error) throw new Error(prepData.error ?? "prepare failed");
        setStatus("signing");
        const signature = await signMessageAsync({ message: { raw: prepData.hash } });
        setStatus("approving");
        const submitRes = await fetch("/api/trade/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken: tradeSession.sessionToken, signature, nonce: prepData.nonce }),
        });
        const submitData = await submitRes.json() as { transactionId?: string; error?: string };
        if (!submitRes.ok || submitData.error) throw new Error(submitData.error ?? "submit failed");
        setApprovedFlag(proxy);
      }
      // Approval done — now place the SELL order
      setCtfApprovalFallback(false);
      setStatus("idle");
      await handlePlaceOrder("SELL", undefined, isMarketOrder);
    } catch (e) {
      const isRejection = /user rejected|user denied|rejected by user/i.test(e instanceof Error ? e.message : "");
      if (isRejection) { setStatus("idle"); setErrorMsg(null); return; }
      const raw = e instanceof Error ? e.message : "approval failed";
      setStatus("error");
      setErrorMsg(humanizeError(raw, t));
    }
  }, [tradeSession, address, proxyAddress, negRisk, isMarketOrder, writeContractAsync, signMessageAsync, handlePlaceOrder, t]);

  const busy = ["authorizing", "approving", "signing", "submitting"].includes(status);

  // ─── COMPACT MODE ────────────────────────────────────────────────────────────
  if (compact) {
    if (!isConnected) return (
      <button onClick={handleConnect} className="text-[9px] px-1.5 py-px border border-[#22c55e]/30 text-[#22c55e] hover:border-[#22c55e]/60 transition-colors">
        {t("trade.connectWallet")}
      </button>
    );
    if (!isPolygon) return (
      <span className="text-[9px] text-[#f59e0b]">{t("trade.switchToPolygon")}</span>
    );
    if (!tradeSession) return (
      <button onClick={handleAuthorize} disabled={busy} className="text-[9px] px-1.5 py-px border border-[#f59e0b]/40 text-[#f59e0b] hover:border-[#f59e0b]/70 transition-colors disabled:opacity-40">
        {status === "authorizing" ? t("trade.authorizing") : t("trade.authorizeToTrade")}
      </button>
    );
    if (needsApproval) return isEOA ? (
      <button onClick={handleEOAApprove} disabled={busy} className="text-[9px] px-1.5 py-px border border-[#f59e0b]/40 text-[#f59e0b] hover:border-[#f59e0b]/70 transition-colors disabled:opacity-40">
        {status === "approving" ? t("trade.approving") : t("trade.approveUsdc")}
      </button>
    ) : (
      <span className="text-[9px] text-[#f59e0b]">{t("trade.approveTokensFirst")}</span>
    );

    // Market order mode — use currentPrice directly, no price input
    const marketPrice = rawPrice;
    const buyEstShares = roundDown(amountNum / marketPrice, SIZE_DECIMALS);
    const potentialPayout = buyEstShares;
    const estUsdcOut = roundDown(amountNum * marketPrice, 2);
    const isBuyTooSmall = amountNum > 0 && amountNum < MIN_BUY_USDC;
    const hasSharesToSell = displayedSharesHeld !== null && displayedSharesHeld > 0.01;
    const activeSellPercent = hasSharesToSell && displayedSharesHeld
      ? SELL_PRESETS.find((pct) => Math.abs(amountNum - roundDown(displayedSharesHeld * (pct / 100), SIZE_DECIMALS)) < 0.01) ?? null
      : null;
    const compactBusyLabel = status === "signing" || status === "submitting" ? "…" : side;
    const compactSlippageCents = quotedMarketPrice !== null ? Math.abs(quotedMarketPrice - currentPrice) * 100 : 0;

    return (
      <div className="font-mono space-y-1.5 py-0.5">
        <div className="flex items-center gap-1">
          {(["BUY", "SELL"] as const).map((option) => (
            <button
              key={option}
              onClick={() => { setSide(option); setAmount(""); setErrorMsg(null); }}
              className={`flex-1 text-[10px] px-2 py-1 border transition-colors ${
                side === option
                  ? option === "BUY"
                    ? "border-[#22c55e]/60 text-[#22c55e] bg-[#22c55e]/6"
                    : "border-[#ff4444]/60 text-[#ff4444] bg-[#ff4444]/8"
                  : "border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--text-muted)]"
              }`}
            >
              {option === "BUY" ? t("common.buy") : t("common.sell")}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {(side === "BUY" ? BUY_PRESETS : SELL_PRESETS).map((preset) => (
            <button
              key={preset}
              onClick={() => {
                if (side === "BUY") {
                  setAmount(String(preset));
                  return;
                }
                if (!displayedSharesHeld) return;
                setAmount(String(roundDown(displayedSharesHeld * (preset / 100), SIZE_DECIMALS)));
              }}
              disabled={side === "SELL" && !hasSharesToSell}
              className={`text-[9px] px-2 py-0.5 border transition-colors ${
                side === "BUY"
                  ? amountNum === preset
                    ? "border-[#22c55e]/60 text-[#22c55e] bg-[#22c55e]/5"
                    : "border-[var(--border)] text-[var(--text-faint)] hover:border-[#22c55e]/30 hover:text-[var(--text-muted)]"
                  : activeSellPercent === preset
                    ? "border-[#ff4444]/60 text-[#ff4444] bg-[#ff4444]/8"
                    : "border-[var(--border)] text-[var(--text-faint)] hover:border-[#ff4444]/30 hover:text-[var(--text-muted)]"
              } disabled:opacity-30`}
            >
              {side === "BUY" ? `$${preset}` : `${preset}%`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-[10px] text-[var(--text-faint)] shrink-0">
              {side === "BUY" ? "$" : "sh"}
            </span>
            <input
              type="number"
              min="0"
              step={side === "BUY" ? "1" : "0.01"}
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`w-16 bg-transparent border px-1.5 py-0.5 text-[11px] tabular-nums text-right text-[var(--text)] outline-none ${
                side === "BUY" ? "border-[#22c55e]/25 focus:border-[#22c55e]/45" : "border-[#ff4444]/25 focus:border-[#ff4444]/45"
              }`}
            />
            {side === "BUY" && availableUsdc !== null && (
              <span className={`text-[9px] shrink-0 ${exceedsBalance ? "text-[#ff4444]" : "text-[var(--text-faint)]"}`}>
                / ${availableUsdc.toFixed(2)}
              </span>
            )}
            {side === "SELL" && hasSharesToSell && (
              <span className={`text-[9px] shrink-0 ${exceedsShares ? "text-[#ff4444]" : "text-[var(--text-faint)]"}`}>
                / {displayedSharesHeld!.toFixed(2)}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {side === "BUY" && amountNum > 0 && !isBuyTooSmall && (
              <span className="text-[10px] tabular-nums text-[#22c55e]/60" title={t("trade.potentialPayout")}>
                ~{potentialPayout.toFixed(2)} {t("common.shares")}
              </span>
            )}
            {side === "SELL" && amountNum > 0 && (
              <span className="text-[10px] tabular-nums text-[#ff4444]/70" title={t("trade.estimatedReturn")}>
                ~${estUsdcOut.toFixed(2)}
              </span>
            )}
            {side === "BUY" && isBuyTooSmall && <span className="text-[10px] text-[#f59e0b]">{t("trade.minBuy")}</span>}
            {side === "BUY" && exceedsBalance && <span className="text-[10px] text-[#ff4444]">{t("trade.exceedsBalance")}</span>}
            {side === "SELL" && amountNum > 0 && amountNum < minSellShares && <span className="text-[10px] text-[#f59e0b]">min {minSellShares}sh</span>}
            {side === "SELL" && exceedsShares && <span className="text-[10px] text-[#ff4444]">{t("trade.exceedsPosition")}</span>}
            {side === "SELL" && !hasSharesToSell && <span className="text-[10px] text-[var(--text-ghost)]">{t("trade.noSharesToSell")}</span>}
          </div>
          <button
            onClick={() => handlePlaceOrder(side, undefined, true)}
            disabled={busy || amountNum <= 0 || exceedsBalance || exceedsShares || (side === "BUY" ? isBuyTooSmall : !hasSharesToSell || amountNum < minSellShares)}
            className={`px-4 py-1 text-[11px] font-medium border transition-colors disabled:opacity-30 ${
              side === "BUY"
                ? "border-[#22c55e]/50 text-[#22c55e] hover:border-[#22c55e]/80 hover:bg-[#22c55e]/8 active:bg-[#22c55e]/15"
                : "border-[#ff4444]/50 text-[#ff4444] hover:border-[#ff4444]/80 hover:bg-[#ff4444]/10 active:bg-[#ff4444]/15"
            }`}
          >
            {compactBusyLabel}
          </button>
        </div>
        {/* Slippage warning (compact) */}
        {compactSlippageCents >= 1 && (
          <div className={`text-[9px] flex items-center justify-between gap-1 ${
            compactSlippageCents >= 5 ? "text-[#ff4444]" : "text-[#f59e0b]"
          }`}>
            <span>{compactSlippageCents >= 5 ? `⚠ ${compactSlippageCents.toFixed(0)}¢ ${t("trade.slippage")} — market moving fast` : `⚠ ${compactSlippageCents.toFixed(0)}¢ ${t("trade.slippage")}`}</span>
            <button
              onClick={() => { quotedAtRef.current = null; setQuotedMarketPrice(null); setQuotedLimitPrice(null); setQuoteRefreshKey(k => k + 1); }}
              className={`border px-1 py-px transition-colors ${
                compactSlippageCents >= 5
                  ? "border-[#ff4444]/50 hover:bg-[#ff4444]/15"
                  : "border-[#f59e0b]/40 hover:bg-[rgba(245,158,11,0.15)]"
              }`}
            >
              {t("common.refresh")}
            </button>
          </div>
        )}
        {/* Status feedback */}
        {status === "done" && <div className="text-[10px] text-[#22c55e]">✓ {t("trade.orderMatched")}</div>}
        {status === "error" && errorMsg && (
          <div className="text-[10px] text-[#ff4444]" title={errorMsg}>{errorMsg}</div>
        )}
      </div>
    );
  }

  // ─── FULL MODE ───────────────────────────────────────────────────────────────
  const effectivePriceForCalc = isMarketOrder ? currentPrice : priceNum;
  const estSharesFull = side === "BUY"
    ? roundDown(amountNum / Math.max(effectivePriceForCalc, minPrice), SIZE_DECIMALS)
    : amountNum;
  const profitIfWin = side === "BUY" ? roundDown(estSharesFull - amountNum, 2) : 0;
  const returnPctFull = amountNum > 0 && side === "BUY" && effectivePriceForCalc > 0
    ? ((1 / effectivePriceForCalc - 1) * 100)
    : 0;
  const receiveUsdcFull = side === "SELL"
    ? roundDown(amountNum * effectivePriceForCalc, 2)
    : 0;

  const adjustPrice = (deltaCents: number) => {
    const newCents = Math.max(centsStep, Math.min(maxPrice * 100,
      roundNormal(priceNum * 100 + deltaCents, centsDecimals)));
    setPrice((newCents / 100).toFixed(priceDecimals));
  };

  // Must be defined before any conditional return to satisfy Rules of Hooks
  const handleFormKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT") return;
    if (e.key === "b" || e.key === "B") { e.preventDefault(); setSide("BUY"); }
    if (e.key === "s" || e.key === "S") { e.preventDefault(); setSide("SELL"); }
    if (e.key === "m" || e.key === "M") { e.preventDefault(); setLimitOnly(v => !v); }
    if (e.key === "1") { e.preventDefault(); setAmount("5"); }
    if (e.key === "2") { e.preventDefault(); setAmount("20"); }
    if (e.key === "3") { e.preventDefault(); setAmount("50"); }
    if (e.key === "4") { e.preventDefault(); setAmount("100"); }
    if (e.key === "Enter" && !busy && amountNum > 0 && (isMarketOrder || priceNum > 0) && !sizeTooSmall) {
      e.preventDefault(); handlePlaceOrder(undefined, undefined, isMarketOrder);
    }
  };

  if (!isConnected) {
    return (
      <div className="font-mono space-y-3">
        <button
          onClick={handleConnect}
          className="w-full py-2.5 bg-[#22c55e] text-black font-bold text-[12px] hover:bg-[#16a34a] active:bg-[#15803d] transition-colors"
        >
          {t("trade.connectWalletFull")}
        </button>
      </div>
    );
  }

  if (!isPolygon) {
    return (
      <div className="font-mono py-4 text-center text-[11px] text-[#f59e0b]">
        {t("trade.switchToPolygonFull")}
      </div>
    );
  }

  return (
    <div className="font-mono flex flex-col gap-3 text-[11px]" tabIndex={-1} onKeyDown={handleFormKey} style={{ outline: "none", minHeight: 340 }}>

      {/* ── Row 1: Buy / Sell tabs + Balance ── */}
      <div className="flex items-center border-b border-[var(--border-subtle)]">
        {(["BUY", "SELL"] as Side[]).map((s) => (
          <button
            key={s}
            onClick={() => { setSide(s); setAmount(""); setErrorMsg(null); setCtfApprovalFallback(false); }}
            className={`px-4 py-1.5 text-[11px] font-bold border-b-2 -mb-px transition-colors ${
              side === s
                ? s === "BUY"
                  ? "border-b-[#22c55e] text-[#22c55e]"
                  : "border-b-[#ff4444] text-[#ff4444]"
                : "border-b-transparent text-[var(--text-faint)] hover:text-[var(--text-muted)]"
            }`}
          >
            {s === "BUY" ? t("common.buy") : t("common.sell")}
          </button>
        ))}
        <div className="ml-auto pr-0.5">
          {availableUsdc !== null && (
            <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
              {t("trade.balance")}{" "}
              <button
                onClick={() => side === "BUY" && setAmount(availableUsdc.toFixed(2))}
                className={`text-[var(--text)] tabular-nums ${side === "BUY" ? "hover:text-[#22c55e] cursor-pointer" : "cursor-default"} transition-colors`}
                title={side === "BUY" ? "Click to use full balance" : undefined}
              >
                ${availableUsdc.toFixed(2)}
              </button>
            </span>
          )}
        </div>
      </div>

      {/* ── Row 2: Price row ── */}
      <div>
        <div className="text-[9px] text-[var(--text-faint)] uppercase tracking-[0.08em] mb-1">{t("trade.price")}</div>
        {!isMarketOrder ? (
          <div className="flex items-center gap-1">
            {(tickSize <= 0.001 ? [-10, -1, -0.1] : [-10, -1]).map((d) => (
              <button
                key={d}
                onClick={() => adjustPrice(d)}
                className="text-[9px] px-2 py-1.5 border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--text-faint)] transition-colors tabular-nums shrink-0"
              >
                {d < -1 || Number.isInteger(d) ? `${d}¢` : `${d.toFixed(1)}¢`}
              </button>
            ))}
            <input
              type="number"
              min={centsStep}
              max={maxPrice * 100}
              step={centsStep}
              value={(priceNum * 100).toFixed(centsDecimals)}
              onChange={(e) => {
                const cents = parseFloat(e.target.value);
                if (!isNaN(cents)) setPrice((Math.max(minPrice, Math.min(maxPrice, cents / 100)).toFixed(priceDecimals)));
              }}
              className="flex-1 bg-transparent border border-[var(--border)] px-2 py-1.5 text-[13px] font-bold text-center text-[var(--text)] tabular-nums outline-none focus:border-[var(--text-faint)]"
            />
            {(tickSize <= 0.001 ? [0.1, 1, 10] : [1, 10]).map((d) => (
              <button
                key={d}
                onClick={() => adjustPrice(d)}
                className="text-[9px] px-2 py-1.5 border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--text-faint)] transition-colors tabular-nums shrink-0"
              >
                +{Number.isInteger(d) ? d : d.toFixed(1)}¢
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-between px-2 py-1.5 border border-[var(--border)] text-[11px]">
            <span className="text-[var(--text-faint)]">{t("trade.marketPrice")}</span>
            <span className="text-[var(--text)] tabular-nums">{(currentPrice * 100).toFixed(centsDecimals)}¢</span>
          </div>
        )}
      </div>

      {/* ── Row 3: Amount ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] text-[var(--text-faint)] uppercase tracking-[0.08em]">
            {side === "BUY" ? t("trade.amountUsdc") : t("common.shares")}
          </span>
          <div className="flex items-center gap-1.5">
            {/* Limit Only toggle */}
            <button
              onClick={() => setLimitOnly(v => !v)}
              className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 border transition-colors ${
                limitOnly
                  ? "border-[#f59e0b]/60 text-[#f59e0b] bg-[#f59e0b]/8"
                  : "border-[var(--border)] text-[var(--text-ghost)] hover:text-[var(--text-faint)] hover:border-[var(--border-subtle)]"
              }`}
              title={limitOnly ? t("trade.limitOnly") : t("trade.limitOnlyOff")}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill={limitOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              {t("trade.limit")}
            </button>
            {/* Max button */}
            {side === "BUY" && availableUsdc !== null && availableUsdc > 0 && (
              <button
                onClick={() => setAmount(availableUsdc.toFixed(2))}
                className="text-[9px] px-1.5 py-0.5 border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
              >
                {t("trade.max")}
              </button>
            )}
            {side === "SELL" && displayedSharesHeld !== null && displayedSharesHeld > 0 && (
              <button
                onClick={() => setAmount(displayedSharesHeld.toFixed(2))}
                className="text-[9px] px-1.5 py-0.5 border border-[var(--border)] text-[#a78bfa] hover:text-[#c4b5fd] transition-colors"
              >
                {t("trade.max")}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex-1 relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-faint)] pointer-events-none select-none">
              {side === "BUY" ? "$" : "sh"}
            </span>
            <input
              ref={amountInputRef}
              type="number"
              min="0"
              step={side === "BUY" ? "1" : "0.01"}
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-transparent border border-[var(--border)] pl-7 pr-2 py-1.5 text-[16px] font-bold text-center text-[var(--text)] tabular-nums outline-none focus:border-[var(--text-faint)]"
            />
          </div>
        </div>

        {/* Presets */}
        <div className="grid grid-cols-4 gap-1 mt-1.5">
          {side === "BUY" ? (
            [50, 100, 500, 1000].map((v) => (
              <button
                key={v}
                onClick={() => setAmount((prev) => {
                  const cur = parseFloat(prev) || 0;
                  return cur === v ? "" : String(cur + v);
                })}
                className={`text-[9px] py-1 border transition-colors tabular-nums ${
                  amountNum === v
                    ? "border-[#ff4444]/60 text-[#ff4444] bg-[#ff4444]/8"
                    : "border-[var(--border)] text-[#ff4444]/60 hover:border-[#ff4444]/40 hover:text-[#ff4444]"
                }`}
              >
                ${v}
              </button>
            ))
          ) : (
            ([10, 25, 50, 100] as const).map((pct) => {
              const shareAmt = displayedSharesHeld ? roundDown(displayedSharesHeld * pct / 100, SIZE_DECIMALS) : null;
              return (
                <button
                  key={pct}
                  onClick={() => { if (shareAmt) setAmount(shareAmt.toFixed(2)); }}
                  disabled={!displayedSharesHeld}
                  className={`text-[9px] py-1 border transition-colors disabled:opacity-30 ${
                    shareAmt !== null && Math.abs(amountNum - shareAmt) < 0.01
                      ? "border-[#ff4444]/60 text-[#ff4444] bg-[#ff4444]/8"
                      : "border-[var(--border)] text-[var(--text-faint)] hover:border-[var(--border-subtle)] hover:text-[var(--text-muted)]"
                  }`}
                >
                  {pct}%
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Slippage guard ── */}
      {(() => {
        const slippageCents = isMarketOrder && quotedMarketPrice !== null
          ? Math.abs(quotedMarketPrice - currentPrice) * 100
          : 0;
        const refreshQuote = () => {
          quotedAtRef.current = null;
          setQuotedMarketPrice(null);
          setQuotedLimitPrice(null);
          setQuoteRefreshKey(k => k + 1);
        };
        if (slippageCents >= 1) return (
          <div className={`text-[9px] border px-2 py-1 flex items-center justify-between gap-2 ${
            slippageCents >= 5
              ? "text-[#ff4444] bg-[rgba(255,68,68,0.08)] border-[#ff4444]/30"
              : "text-[#f59e0b] bg-[rgba(245,158,11,0.08)] border-[#f59e0b]/30"
          }`}>
            <span>{slippageCents >= 5 ? t("trade.priceMoved", { cents: slippageCents.toFixed(0) }) : t("trade.priceMovedShort", { cents: slippageCents.toFixed(0) })}</span>
            <button
              onClick={refreshQuote}
              className={`text-[9px] border px-1.5 py-0.5 transition-colors shrink-0 ${
                slippageCents >= 5
                  ? "border-[#ff4444]/50 hover:bg-[#ff4444]/15"
                  : "border-[#f59e0b]/40 hover:bg-[rgba(245,158,11,0.15)]"
              }`}
            >
              {t("common.refresh")}
            </button>
          </div>
        );
        return null;
      })()}

      {/* ── Row 4: Position info + market order indicator ── */}
      <div className="flex items-center gap-2">
        {isMarketOrder && quotedMarketPrice && (
          <span className="text-[9px] text-[var(--text-faint)] tabular-nums">
            {t("trade.estFill", { price: (quotedMarketPrice * 100).toFixed(1) })}
          </span>
        )}
        {side === "BUY" && displayedSharesHeld !== null && displayedSharesHeld > 0 && (
          <button
            onClick={() => { setSide("SELL"); setAmount(displayedSharesHeld!.toFixed(2)); }}
            className="text-[9px] text-[#a78bfa] hover:text-[#c4b5fd] transition-colors tabular-nums ml-auto"
            title={t("trade.clickToSellAll")}
          >
            {displayedSharesHeld.toFixed(2)} {t("common.shares")}
          </button>
        )}
      </div>

      {/* ── Row 5: Summary ── */}
      <div className="space-y-1.5 py-2 border-t border-b border-[var(--border-subtle)] tabular-nums">
        {sizeTooSmall ? (
          <div className="text-[10px] text-[#f59e0b]">
            {side === "BUY" ? t("trade.minUsdc", { amount: MIN_BUY_USDC }) : t("trade.minShares", { amount: minSellShares })}
          </div>
        ) : side === "BUY" ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-faint)]">{t("common.shares")}</span>
              <span className="text-[var(--text)]">{amountNum > 0 ? `~${estSharesFull.toFixed(2)}` : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-faint)]">{t("common.total")}</span>
              <span className="text-[var(--text)]">${amountNum > 0 ? amountNum.toFixed(2) : "0.00"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-faint)]">{t("trade.return")}</span>
              <span className={amountNum > 0 && profitIfWin > 0 ? "text-[#22c55e]" : "text-[var(--text-muted)]"}>
                {amountNum > 0
                  ? `$${profitIfWin.toFixed(2)} (${returnPctFull.toFixed(0)}%)`
                  : "$0.00 (0%)"}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-faint)]">{t("trade.receive")}</span>
            <span className="text-[var(--text)]">{amountNum > 0 ? `~$${receiveUsdcFull.toFixed(2)}` : "—"}</span>
          </div>
        )}
      </div>

      {/* Spacer pushes action button to bottom */}
      <div className="flex-1" />

      {/* ── Row 6: Action ── */}
      {!tradeSession ? (
        <button
          onClick={handleAuthorize}
          disabled={busy}
          className="w-full py-2.5 bg-[#f59e0b] text-black font-bold text-[12px] hover:bg-[#d97706] transition-colors disabled:opacity-40"
        >
          {status === "authorizing" ? t("trade.authorizingFull") : t("trade.authorizeTradingFull")}
        </button>
      ) : (needsCTFApproval || ctfApprovalFallback) ? (
        <button
          onClick={handleApproveCTFAndSell}
          disabled={busy || amountNum <= 0 || sizeTooSmall}
          className="w-full py-2.5 bg-[#f59e0b] text-black font-bold text-[12px] hover:bg-[#d97706] active:bg-[#b45309] transition-colors disabled:opacity-40"
        >
          {status === "approving" ? t("trade.approving") : status === "signing" ? t("trade.signInWallet") : t("trade.approveSell")}
        </button>
      ) : needsApproval ? (
        isEOA ? (
          <button
            onClick={handleEOAApprove}
            disabled={busy}
            className="w-full py-2.5 bg-[#f59e0b] text-black font-bold text-[12px] hover:bg-[#d97706] transition-colors disabled:opacity-40"
          >
            {status === "approving" ? t("trade.approving") : t("trade.approveUsdcFull")}
          </button>
        ) : (
          <div className="w-full py-2 text-center text-[10px] text-[#f59e0b] border border-[#f59e0b]/30">
            {t("trade.approveTokensFirstFull")}
          </div>
        )
      ) : (
        <button
          onClick={() => handlePlaceOrder(undefined, undefined, isMarketOrder)}
          disabled={busy || amountNum <= 0 || (!isMarketOrder && priceNum <= 0) || sizeTooSmall || exceedsBalance || exceedsShares}
          className={`w-full py-2.5 font-bold text-[13px] transition-colors disabled:opacity-40 ${
            side === "BUY"
              ? "bg-[#22c55e] text-black hover:bg-[#16a34a] active:bg-[#15803d]"
              : "bg-[#ff4444] text-white hover:bg-[#dc2626] active:bg-[#b91c1c]"
          }`}
        >
          {status === "signing"    ? t("trade.signInWallet") :
           status === "submitting" ? t("trade.submittingOrder")     :
           `${side === "BUY" ? t("common.buy") : t("common.sell")} ${outcomeName}`}
        </button>
      )}

      {/* Status line — fixed height so button doesn't shift */}
      <div className="h-4 text-center">
        {exceedsBalance && (
          <span className="text-[10px] text-[#ff4444]">{t("trade.insufficientBalanceStatus", { available: availableUsdc?.toFixed(2) ?? "0" })}</span>
        )}
        {exceedsShares && (
          <span className="text-[10px] text-[#ff4444]">{t("trade.exceedsPositionStatus", { shares: displayedSharesHeld?.toFixed(2) ?? "0" })}</span>
        )}
        {status === "done" && (
          <span className="text-[11px] text-[#22c55e]">
            ✓ {t("trade.orderPlaced")}{orderId && orderId !== "submitted" ? ` · ${orderId.slice(0, 16)}…` : ""}
          </span>
        )}
        {status === "error" && errorMsg && (
          <span className="text-[10px] text-[#ff4444] break-all">{errorMsg}</span>
        )}
      </div>
    </div>
  );
}
