import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchMarketTrades } from "@/lib/smartMoney";
import type { SmartWallet, WhaleTrade } from "@/types";
import { SingleCache } from "@/lib/apiCache";
import { apiError } from "@/lib/apiError";

export const dynamic = "force-dynamic";

const tradeCache = new SingleCache<{ whaleTrades: WhaleTrade[]; smartTrades: WhaleTrade[] }>(30_000);
let bgFetchInProgress = false;

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

/** Fetch live trades from Polymarket API and persist to DB + cache */
async function fetchAndCacheLiveTrades(smartAddresses: Set<string>): Promise<void> {
  try {
    const [whaleRaw, smartRaw] = await Promise.all([
      fetchMarketTrades("", 5000),
      fetchMarketTrades("", 1000),
    ]);

    const whaleTrades = whaleRaw.map((t) => mapApiTrade(t, smartAddresses));

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

    tradeCache.set({ whaleTrades, smartTrades });

    // Persist to DB
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
    console.error("[api/smart-money] Background fetch error:", e);
  } finally {
    bgFetchInProgress = false;
  }
}

/** Read trades from DB (fast, no external API) */
function readTradesFromDb(
  db: ReturnType<typeof getDb>,
  usernameMap: Map<string, string>,
): { whaleTrades: WhaleTrade[]; smartTrades: WhaleTrade[] } {
  const dbRows = db
    .prepare(
      `SELECT wallet, condition_id, event_id, side, size, price, usdc_size, outcome, title, slug, timestamp, is_smart_wallet
       FROM whale_trades
       WHERE timestamp > datetime('now', '-24 hours')
       ORDER BY timestamp DESC
       LIMIT 200`
    )
    .all() as Array<Record<string, unknown>>;

  const whaleTrades: WhaleTrade[] = [];
  const smartTrades: WhaleTrade[] = [];

  for (const r of dbRows) {
    const t: WhaleTrade = {
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
    };
    if (t.usdcSize >= 5000) whaleTrades.push(t);
    if (t.isSmartWallet) smartTrades.push(t);
  }

  return {
    whaleTrades: whaleTrades.slice(0, 100),
    smartTrades: smartTrades.slice(0, 100),
  };
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "all";

    // Read leaderboard from cache (all periods stored in DB: day/week/month/all)
    const timePeriod = ["day", "week", "month", "all"].includes(period) ? period : "all";
    const lbRows = db
      .prepare(
        `SELECT address, username, pnl, volume, rank, profile_image
         FROM leaderboard_cache WHERE time_period = ? ORDER BY rank ASC LIMIT 50`
      )
      .all(timePeriod) as Array<Record<string, unknown>>;

    let leaderboard: SmartWallet[];
    if (lbRows.length > 0) {
      leaderboard = lbRows.map((r) => ({
        address: r.address as string,
        username: (r.username as string) || null,
        pnl: r.pnl as number,
        volume: r.volume as number,
        rank: r.rank as number,
        profileImage: (r.profile_image as string) || null,
      }));
    } else {
      // Fallback to smart_wallets if cache not yet populated
      const topRows = db
        .prepare(
          `SELECT address, username, pnl, volume, rank, profile_image
           FROM smart_wallets ORDER BY rank ASC LIMIT 50`
        )
        .all() as Array<Record<string, unknown>>;
      leaderboard = topRows.map((r) => ({
        address: r.address as string,
        username: (r.username as string) || null,
        pnl: r.pnl as number,
        volume: r.volume as number,
        rank: r.rank as number,
        profileImage: (r.profile_image as string) || null,
      }));
    }

    // Fast path: only leaderboard data needed (period toggle)
    const leaderboardOnly = searchParams.get("leaderboardOnly") === "1";
    if (leaderboardOnly) {
      return NextResponse.json({ leaderboard });
    }

    // Build smart wallet address set from ALL tracked wallets (PnL >= $100k)
    const allWalletRows = db
      .prepare(`SELECT address FROM smart_wallets`)
      .all() as Array<{ address: string }>;
    const smartAddresses = new Set(
      allWalletRows.map((r) => r.address.toLowerCase())
    );

    // Build wallet→username lookup from smart_wallets
    const usernameMap = new Map<string, string>();
    const usernameRows = db
      .prepare(`SELECT address, username FROM smart_wallets WHERE username IS NOT NULL AND username != ''`)
      .all() as Array<{ address: string; username: string }>;
    for (const r of usernameRows) usernameMap.set(r.address.toLowerCase(), r.username);

    // Use cached live trades if available, otherwise read from DB (fast)
    const cached = tradeCache.get();
    let whaleTrades: WhaleTrade[];
    let smartTrades: WhaleTrade[];

    if (cached) {
      // Merge cached live trades with DB history
      const dbResult = readTradesFromDb(db, usernameMap);
      const whaleMap = new Map<string, WhaleTrade>();
      for (const t of cached.whaleTrades) whaleMap.set(`${t.wallet}-${t.conditionId}-${t.timestamp}`, t);
      for (const t of dbResult.whaleTrades) {
        const key = `${t.wallet}-${t.conditionId}-${t.timestamp}`;
        if (!whaleMap.has(key)) whaleMap.set(key, t);
      }
      whaleTrades = Array.from(whaleMap.values())
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 100);

      const smartMap = new Map<string, WhaleTrade>();
      for (const t of cached.smartTrades) smartMap.set(`${t.wallet}-${t.conditionId}-${t.timestamp}`, t);
      for (const t of dbResult.smartTrades) {
        const key = `${t.wallet}-${t.conditionId}-${t.timestamp}`;
        if (!smartMap.has(key)) smartMap.set(key, t);
      }
      smartTrades = Array.from(smartMap.values())
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 100);
    } else {
      // Cold start: return DB data immediately, fetch live in background
      const dbResult = readTradesFromDb(db, usernameMap);
      whaleTrades = dbResult.whaleTrades;
      smartTrades = dbResult.smartTrades;

      if (!bgFetchInProgress) {
        bgFetchInProgress = true;
        fetchAndCacheLiveTrades(smartAddresses);
      }
    }

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
    return apiError("smart-money", "Failed to fetch smart money data", 500, err);
  }
}
