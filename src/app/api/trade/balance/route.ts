import { NextRequest, NextResponse } from "next/server";
import { getTradeSession } from "@/lib/tradeSession";

const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const BALANCE_CACHE_TTL_MS = 30_000;

declare global {
  var _balanceCache:
    | Map<string, { balance: number; expiresAt: number }>
    | undefined;
}

const balanceCache =
  globalThis._balanceCache ?? (globalThis._balanceCache = new Map());

function getRpcUrls(): string[] {
  const configured = process.env.POLYGON_RPC_URLS
    ?.split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return configured?.length ? configured : ["https://rpc.ankr.com/polygon"];
}

function readCachedBalance(address: string): number | null {
  const now = Date.now();
  const key = address.toLowerCase();
  const entry = balanceCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    balanceCache.delete(key);
    return null;
  }
  return entry.balance;
}

function writeCachedBalance(address: string, balance: number) {
  balanceCache.set(address.toLowerCase(), {
    balance,
    expiresAt: Date.now() + BALANCE_CACHE_TTL_MS,
  });
}

async function getOnChainUsdcBalance(address: string): Promise<number> {
  const cached = readCachedBalance(address);
  if (cached !== null) return cached;

  // balanceOf(address) — ABI-encode the address into 32 bytes (left-pad with zeros)
  const addr = address.startsWith("0x") ? address.slice(2) : address;
  const data = "0x70a08231" + addr.toLowerCase().padStart(64, "0");
  for (const rpc of getRpcUrls()) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", method: "eth_call",
          params: [{ to: USDC_E, data }, "latest"],
          id: 1,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      const json = await res.json() as { result?: string; error?: unknown };
      if (json.error || !json.result || json.result === "0x") continue;
      const raw = BigInt(json.result);
      const balance = Number(raw) / 1e6;
      writeCachedBalance(address, balance);
      return balance;
    } catch { /* try next RPC */ }
  }
  throw new Error("all RPCs failed");
}

// GET /api/trade/balance?address=0x... — public on-chain USDC.e balance (origin-restricted)
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  const isDev = process.env.NODE_ENV !== "production";
  const originOk =
    origin.startsWith("https://polyworld.bet") ||
    (isDev && (origin === "" || origin.startsWith("http://localhost")));
  if (!originOk) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const addr = req.nextUrl.searchParams.get("address") ?? "";
  if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    return NextResponse.json({ error: "valid address required" }, { status: 400 });
  }
  try {
    const balance = await getOnChainUsdcBalance(addr);
    return NextResponse.json({ balance });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "rpc failed" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { sessionToken } = await req.json();
    if (typeof sessionToken !== "string" || !sessionToken) {
      return NextResponse.json({ error: "sessionToken required" }, { status: 400 });
    }
    const session = getTradeSession(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "invalid or expired trade session" }, { status: 401 });
    }
    const proxyAddress = session.proxyAddress;
    const balance = await getOnChainUsdcBalance(proxyAddress);
    return NextResponse.json({ balance });
  } catch (e) {
    console.error("[balance] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to fetch balance" },
      { status: 500 }
    );
  }
}
