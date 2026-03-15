"use client";

import { polygon } from "wagmi/chains";

export interface TradeSessionClient {
  sessionToken: string;
  proxyAddress: string;
}

const CLOB_AUTH_DOMAIN = {
  name: "ClobAuthDomain",
  version: "1",
  chainId: polygon.id,
} as const;

const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "message", type: "string" },
  ],
} as const;

const CLOB_MSG = "This message attests that I control the given wallet";

function proxyLocalStorageKey(eoa: string): string {
  return `pw:proxy:${eoa.toLowerCase()}`;
}

const SESSION_KEY = (eoa: string) => `pw:session:${eoa.toLowerCase()}`;
const APPROVED_KEY = (proxy: string) => `pw:approved:${proxy.toLowerCase()}`;

export function saveTradeSession(eoa: string, session: TradeSessionClient): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(SESSION_KEY(eoa), JSON.stringify(session)); } catch { /* ignore */ }
}

export function loadTradeSession(eoa: string): TradeSessionClient | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY(eoa));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return (data?.sessionToken && data?.proxyAddress) ? data as TradeSessionClient : null;
  } catch { return null; }
}

export function clearSavedTradeSession(eoa: string): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(SESSION_KEY(eoa)); } catch { /* ignore */ }
}

export function getApprovedFlag(proxy: string): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(APPROVED_KEY(proxy)) === "1"; } catch { return false; }
}

export function setApprovedFlag(proxy: string): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(APPROVED_KEY(proxy), "1"); } catch { /* ignore */ }
}

export function getCachedProxyWallet(eoa: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(proxyLocalStorageKey(eoa));
}

export function setCachedProxyWallet(eoa: string, proxy: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(proxyLocalStorageKey(eoa), proxy);
}

export async function lookupProxyWallet(address: string): Promise<string> {
  // Priority 0: localStorage cache
  const cached = getCachedProxyWallet(address);
  if (cached) return cached;

  const res = await fetch(`/api/trade/proxy-wallet?address=${address}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "failed to look up proxy wallet");
  }
  if (!data.proxyWallet) {
    throw new Error("PROXY_NOT_FOUND");
  }

  // Cache for future sessions
  setCachedProxyWallet(address, data.proxyWallet);
  return data.proxyWallet;
}

export async function authorizeTradeSession(
  address: string,
  proxyAddress: string,
  signTypedDataAsync: (args: {
    domain: typeof CLOB_AUTH_DOMAIN;
    types: typeof CLOB_AUTH_TYPES;
    primaryType: "ClobAuth";
    message: {
      address: `0x${string}`;
      timestamp: string;
      nonce: bigint;
      message: string;
    };
  }) => Promise<string>
): Promise<TradeSessionClient> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signTypedDataAsync({
    domain: CLOB_AUTH_DOMAIN,
    types: CLOB_AUTH_TYPES,
    primaryType: "ClobAuth",
    message: {
      address: address as `0x${string}`,  // EOA — ecrecover(sig) must equal POLY_ADDRESS
      timestamp: String(timestamp),
      nonce: BigInt(0),
      message: CLOB_MSG,
    },
  });

  const res = await fetch("/api/trade/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, proxyAddress, signature, timestamp, nonce: 0 }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error ?? "authorization failed");
  }

  return {
    sessionToken: data.sessionToken,
    proxyAddress: data.proxyAddress,
  };
}
