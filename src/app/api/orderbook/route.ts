import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CLOB_BASE = "https://clob.polymarket.com";

// ── Server-side memory cache (10s TTL) ──
interface BookCache {
  data: Record<string, unknown>;
  fetchedAt: number;
}
const CACHE_TTL = 10_000;
const bookCache = new Map<string, BookCache>();

export async function GET(request: NextRequest) {
  const tokenId = request.nextUrl.searchParams.get("tokenId");

  if (!tokenId) {
    return NextResponse.json({ error: "tokenId required" }, { status: 400 });
  }

  // Check cache
  const cached = bookCache.get(tokenId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const res = await fetch(`${CLOB_BASE}/book?token_id=${tokenId}`, {
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `CLOB API error: ${res.status}` },
        { status: 502 },
      );
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

    // Update cache
    bookCache.set(tokenId, { data, fetchedAt: Date.now() });

    // Prune stale entries
    if (bookCache.size > 200) {
      const now = Date.now();
      for (const [k, v] of bookCache) {
        if (now - v.fetchedAt > 60_000) bookCache.delete(k);
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/orderbook] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch orderbook" },
      { status: 500 },
    );
  }
}
