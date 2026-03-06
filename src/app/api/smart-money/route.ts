import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchMarketTrades } from "@/lib/smartMoney";
import type { SmartWallet, WhaleTrade } from "@/types";

export const dynamic = "force-dynamic";

// ── Server-side memory cache (30s TTL) ──
interface TradeCache {
  whaleTrades: WhaleTrade[];
  smartTrades: WhaleTrade[];
  fetchedAt: number;
}
const CACHE_TTL = 30_000; // 30s
let tradeCache: TradeCache | null = null;

function mapApiTrade(
  t: Awaited<ReturnType<typeof fetchMarketTrades>>[number],
  smartAddresses: Set<string>,
): WhaleTrade {
  const isSmart = smartAddresses.has(t.wallet.toLowerCase());
  return {
    wallet: t.wallet,
    username: t.username || undefined,
    conditionId: t.conditionId,
    eventId: null,
    side: t.side,
    size: t.size,
    price: t.price,
    usdcSize: t.usdcSize,
    outcome: t.outcome,
    title: t.title,
    slug: t.eventSlug || t.slug,
    timestamp: t.timestamp,
    isSmartWallet: isSmart,
  };
}

async function getLiveTrades(smartAddresses: Set<string>): Promise<{
  whaleTrades: WhaleTrade[];
  smartTrades: WhaleTrade[];
}> {
  // Return cached if fresh
  if (tradeCache && Date.now() - tradeCache.fetchedAt < CACHE_TTL) {
    return { whaleTrades: tradeCache.whaleTrades, smartTrades: tradeCache.smartTrades };
  }

  // Fetch both thresholds in parallel
  const [whaleRaw, smartRaw] = await Promise.all([
    fetchMarketTrades("", 5000),
    fetchMarketTrades("", 1000),
  ]);

  const whaleTrades = whaleRaw.map((t) => mapApiTrade(t, smartAddresses));

  // Smart trades: from the $1000+ pool, only keep smart wallet trades
  // Also merge any smart wallet trades from the whale pool that aren't duplicated
  const smartTradeMap = new Map<string, WhaleTrade>();
  for (const t of smartRaw) {
    if (!smartAddresses.has(t.wallet.toLowerCase())) continue;
    const key = `${t.wallet}-${t.conditionId}-${t.timestamp}`;
    if (!smartTradeMap.has(key)) {
      smartTradeMap.set(key, mapApiTrade(t, smartAddresses));
    }
  }
  const smartTrades = Array.from(smartTradeMap.values())
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Update cache
  tradeCache = { whaleTrades, smartTrades, fetchedAt: Date.now() };

  // Persist all trades to DB for historical record
  try {
    const db = getDb();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO whale_trades
        (wallet, condition_id, event_id, side, size, price, usdc_size, outcome, title, slug, timestamp, is_smart_wallet)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const allTrades = [...whaleTrades, ...smartTrades];
    const seen = new Set<string>();
    db.transaction(() => {
      for (const t of allTrades) {
        const key = `${t.wallet}-${t.conditionId}-${t.timestamp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        insert.run(
          t.wallet, t.conditionId, t.eventId, t.side,
          t.size, t.price, t.usdcSize, t.outcome,
          t.title, t.slug, t.timestamp, t.isSmartWallet ? 1 : 0,
        );
      }
    })();
  } catch (e) {
    console.error("[api/smart-money] DB persist error:", e);
  }

  return { whaleTrades, smartTrades };
}

export async function GET() {
  try {
    const db = getDb();

    // Leaderboard display: top 50 by rank
    const topRows = db
      .prepare(
        `SELECT address, username, pnl, volume, rank, profile_image
         FROM smart_wallets ORDER BY rank ASC LIMIT 50`
      )
      .all() as Array<Record<string, unknown>>;

    const leaderboard: SmartWallet[] = topRows.map((r) => ({
      address: r.address as string,
      username: (r.username as string) || null,
      pnl: r.pnl as number,
      volume: r.volume as number,
      rank: r.rank as number,
      profileImage: (r.profile_image as string) || null,
    }));

    // Build smart wallet address set from ALL tracked wallets (PnL >= $100k)
    const allWalletRows = db
      .prepare(`SELECT address FROM smart_wallets`)
      .all() as Array<{ address: string }>;
    const smartAddresses = new Set(
      allWalletRows.map((r) => r.address.toLowerCase())
    );

    // Fetch live trades from Polymarket API (30s cache)
    const { whaleTrades: liveWhale, smartTrades: liveSmart } = await getLiveTrades(smartAddresses);

    // Build wallet→username lookup from smart_wallets
    const usernameMap = new Map<string, string>();
    const usernameRows = db
      .prepare(`SELECT address, username FROM smart_wallets WHERE username IS NOT NULL AND username != ''`)
      .all() as Array<{ address: string; username: string }>;
    for (const r of usernameRows) usernameMap.set(r.address.toLowerCase(), r.username);

    // Read historical trades from DB (last 24h) and merge with live
    const dbRows = db
      .prepare(
        `SELECT wallet, condition_id, event_id, side, size, price, usdc_size, outcome, title, slug, timestamp, is_smart_wallet
         FROM whale_trades
         WHERE timestamp > datetime('now', '-24 hours')
         ORDER BY timestamp DESC
         LIMIT 200`
      )
      .all() as Array<Record<string, unknown>>;

    const dbTrades: WhaleTrade[] = dbRows.map((r) => ({
      wallet: r.wallet as string,
      username: usernameMap.get((r.wallet as string).toLowerCase()) || undefined,
      conditionId: r.condition_id as string,
      eventId: (r.event_id as string) || null,
      side: r.side as "BUY" | "SELL",
      size: r.size as number,
      price: r.price as number,
      usdcSize: r.usdc_size as number,
      outcome: r.outcome as string,
      title: r.title as string,
      slug: r.slug as string,
      timestamp: r.timestamp as string,
      isSmartWallet: (r.is_smart_wallet as number) === 1,
    }));

    // Merge: live trades take priority (have username), then fill with DB history
    const whaleMap = new Map<string, WhaleTrade>();
    for (const t of liveWhale) whaleMap.set(`${t.wallet}-${t.conditionId}-${t.timestamp}`, t);
    for (const t of dbTrades) {
      if ((t.usdcSize || 0) < 5000) continue;
      const key = `${t.wallet}-${t.conditionId}-${t.timestamp}`;
      if (!whaleMap.has(key)) whaleMap.set(key, t);
    }
    const whaleTrades = Array.from(whaleMap.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 100);

    const smartMap = new Map<string, WhaleTrade>();
    for (const t of liveSmart) smartMap.set(`${t.wallet}-${t.conditionId}-${t.timestamp}`, t);
    for (const t of dbTrades) {
      if (!t.isSmartWallet) continue;
      const key = `${t.wallet}-${t.conditionId}-${t.timestamp}`;
      if (!smartMap.has(key)) smartMap.set(key, t);
    }
    const smartTrades = Array.from(smartMap.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 100);

    // Last leaderboard sync time
    const walletMeta = db
      .prepare(`SELECT MAX(updated_at) as last_sync FROM smart_wallets`)
      .get() as { last_sync: string | null } | undefined;

    return NextResponse.json({
      leaderboard,
      recentTrades: whaleTrades,
      smartTrades,
      lastSync: walletMeta?.last_sync || null,
    });
  } catch (err) {
    console.error("[api/smart-money] Error:", err);
    return NextResponse.json(
      { leaderboard: [], recentTrades: [], smartTrades: [], lastSync: null },
      { status: 500 }
    );
  }
}
