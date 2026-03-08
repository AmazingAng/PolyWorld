import { NextRequest, NextResponse } from "next/server";
import { ApiCache } from "@/lib/apiCache";
import { apiError } from "@/lib/apiError";

export const dynamic = "force-dynamic";

const CLOB_BASE = "https://clob.polymarket.com";

const bookCache = new ApiCache<Record<string, unknown>>(10_000, 200);

export async function GET(request: NextRequest) {
  const tokenId = request.nextUrl.searchParams.get("tokenId");

  if (!tokenId) {
    return NextResponse.json({ error: "tokenId required" }, { status: 400 });
  }

  const cached = bookCache.get(tokenId);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const res = await fetch(`${CLOB_BASE}/book?token_id=${tokenId}`, {
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      // Return 200 with empty data so the browser doesn't log a red 502 error.
      // The OrderBook component will try the next token ID.
      return NextResponse.json({ bids: [], asks: [], error: `CLOB ${res.status}` });
    }

    const raw = await res.json();

    const bids: { price: number; size: number; cumSize: number }[] = [];
    const asks: { price: number; size: number; cumSize: number }[] = [];

    // Parse bids (sorted high → low)
    const rawBids = (raw.bids || []) as { price: string; size: string }[];
    rawBids.sort(
      (a: { price: string }, b: { price: string }) =>
        parseFloat(b.price) - parseFloat(a.price),
    );
    let cumBid = 0;
    for (const b of rawBids) {
      const size = parseFloat(b.size);
      cumBid += size;
      bids.push({ price: parseFloat(b.price), size, cumSize: cumBid });
    }

    // Parse asks (sorted low → high)
    const rawAsks = (raw.asks || []) as { price: string; size: string }[];
    rawAsks.sort(
      (a: { price: string }, b: { price: string }) =>
        parseFloat(a.price) - parseFloat(b.price),
    );
    let cumAsk = 0;
    for (const a of rawAsks) {
      const size = parseFloat(a.size);
      cumAsk += size;
      asks.push({ price: parseFloat(a.price), size, cumSize: cumAsk });
    }

    const bestBid = bids.length > 0 ? bids[0].price : 0;
    const bestAsk = asks.length > 0 ? asks[0].price : 0;
    const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
    const midPrice =
      bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : 0;
    const lastTradePrice = raw.last_trade_price
      ? parseFloat(raw.last_trade_price)
      : 0;
    const tickSize = raw.tick_size ? parseFloat(raw.tick_size) : 0.001;

    const data = {
      bids: bids.slice(0, 15),
      asks: asks.slice(0, 15),
      lastTradePrice,
      spread,
      midPrice,
      tickSize,
    };

    bookCache.set(tokenId, data);

    return NextResponse.json(data);
  } catch (err) {
    return apiError("orderbook", "Failed to fetch orderbook", 500, err);
  }
}
