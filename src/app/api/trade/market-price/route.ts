import { NextRequest, NextResponse } from "next/server";
import { bufferMarketPrice, calculateMarketExecutionPrice, type BookLevel, type MarketSide } from "@/lib/marketOrder";

const CLOB_BASE = "https://clob.polymarket.com";
const ORDERBOOK_TIMEOUT_MS = 5_000;

function sortLevels(levels: BookLevel[], side: "bids" | "asks"): BookLevel[] {
  return [...levels].sort((a, b) => {
    const left = typeof a.price === "number" ? a.price : Number.parseFloat(a.price);
    const right = typeof b.price === "number" ? b.price : Number.parseFloat(b.price);
    return side === "bids" ? right - left : left - right;
  });
}

export async function POST(req: NextRequest) {
  try {
    const { tokenId, side, amount } = await req.json() as {
      tokenId?: string;
      side?: MarketSide;
      amount?: number;
    };
    const startedAt = Date.now();

    if (!tokenId || (side !== "BUY" && side !== "SELL") || !(typeof amount === "number" && amount > 0)) {
      return NextResponse.json({ error: "tokenId, side, and positive amount are required" }, { status: 400 });
    }

    const res = await fetch(`${CLOB_BASE}/book?token_id=${encodeURIComponent(tokenId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(ORDERBOOK_TIMEOUT_MS),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `failed to fetch orderbook (${res.status})` }, { status: 502 });
    }

    const raw = await res.json() as {
      bids?: BookLevel[];
      asks?: BookLevel[];
      tick_size?: string | number;
    };

    const bids = sortLevels(Array.isArray(raw.bids) ? raw.bids : [], "bids");
    const asks = sortLevels(Array.isArray(raw.asks) ? raw.asks : [], "asks");
    const tickSize = typeof raw.tick_size === "number" ? raw.tick_size : Number.parseFloat(raw.tick_size ?? "0.01");

    const executionPrice = calculateMarketExecutionPrice(side, amount, bids, asks);
    const limitPrice = bufferMarketPrice(side, executionPrice, tickSize);
    console.log("[trade/market-price] quote", {
      tokenId,
      side,
      amount,
      elapsedMs: Date.now() - startedAt,
      bestBid: bids[0]?.price ?? null,
      bestAsk: asks[0]?.price ?? null,
      bidLevels: bids.length,
      askLevels: asks.length,
      executionPrice,
      limitPrice,
      tickSize: Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0.01,
    });

    return NextResponse.json({
      executionPrice,
      limitPrice,
      tickSize: Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0.01,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to quote market price";
    console.error("[trade/market-price] error", { message, err });
    const status = message === "insufficient liquidity" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
