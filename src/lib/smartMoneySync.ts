import { getDb } from "./db";
import { fetchLeaderboard, fetchFullLeaderboard, fetchMarketTrades } from "./smartMoney";
import type { LeaderboardTimePeriod } from "./smartMoney";
import { SMART_MONEY_MS, LEADERBOARD_MS } from "./syncIntervals";
import { CircuitBreaker } from "./circuitBreaker";

const SYNC_INTERVAL = SMART_MONEY_MS;
const smartMoneyBreaker = new CircuitBreaker<void>("smartMoneySync", 5, 60_000);
const FULL_LEADERBOARD_INTERVAL = LEADERBOARD_MS;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let fullLeaderboardTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Full leaderboard sync: fetch all wallets with PnL >= $100k.
 * Runs once on startup and then every hour.
 */
export async function runFullLeaderboardSync(): Promise<void> {
  const db = getDb();
  try {
    console.info("[smartMoney] Starting full leaderboard sync (PnL >= $100k)...");
    const leaderboard = await fetchFullLeaderboard(100_000);
    if (leaderboard.length === 0) return;

    // Safety: skip if new data is less than 50% of current table size (partial API response)
    const currentCount = (db.prepare(`SELECT COUNT(*) as c FROM smart_wallets`).get() as { c: number }).c;
    if (currentCount > 0 && leaderboard.length < currentCount * 0.5) {
      console.warn(`[smartMoney] Skipping full leaderboard wipe: API returned ${leaderboard.length} vs ${currentCount} existing (need ≥50%)`);
      return;
    }

    const upsertWallet = db.prepare(`
      INSERT INTO smart_wallets (address, username, pnl, volume, rank, profile_image, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(address) DO UPDATE SET
        username = excluded.username,
        pnl = excluded.pnl,
        volume = excluded.volume,
        rank = excluded.rank,
        profile_image = excluded.profile_image,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `);

    // Replace wallets that dropped below threshold
    db.transaction(() => {
      db.prepare(`DELETE FROM smart_wallets WHERE 1`).run();
      for (const w of leaderboard) {
        upsertWallet.run(
          w.address,
          w.username || null,
          w.pnl,
          w.volume,
          w.rank,
          w.profileImage || null
        );
      }
    })();

    console.info(`[smartMoney] Full leaderboard sync complete — ${leaderboard.length} wallets (PnL >= $100k)`);
  } catch (err) {
    console.error("[smartMoney] Full leaderboard sync error:", err);
  }
}

/**
 * Sync leaderboard cache for all time periods (TODAY, WEEKLY, MONTHLY, ALL).
 * Fetches top 50 from Polymarket API for each period and stores in leaderboard_cache.
 */
async function syncLeaderboardCache(): Promise<void> {
  const db = getDb();
  const periods: LeaderboardTimePeriod[] = ["day", "week", "month", "all"];

  const upsert = db.prepare(`
    INSERT INTO leaderboard_cache (time_period, rank, address, username, pnl, volume, profile_image, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(time_period, rank) DO UPDATE SET
      address = excluded.address,
      username = excluded.username,
      pnl = excluded.pnl,
      volume = excluded.volume,
      profile_image = excluded.profile_image,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `);
  const deletePeriod = db.prepare(`DELETE FROM leaderboard_cache WHERE time_period = ?`);

  for (const period of periods) {
    try {
      const entries = await fetchLeaderboard(50, period);
      if (entries.length === 0) continue;
      db.transaction(() => {
        deletePeriod.run(period);
        for (const e of entries) {
          upsert.run(period, e.rank, e.address, e.username || null, e.pnl, e.volume, e.profileImage || null);
        }
      })();
    } catch (err) {
      console.error(`[smartMoney] Leaderboard cache sync error for ${period}:`, err);
    }
  }
  console.info(`[smartMoney] Leaderboard cache synced (${periods.join(", ")})`);
}

export async function runSmartMoneySync(): Promise<void> {
  await smartMoneyBreaker.call(async () => {
  const db = getDb();

  try {
    // 1. Quick top-50 refresh (keeps rank/pnl fresh between full syncs)
    const leaderboard = await fetchLeaderboard(50);
    if (leaderboard.length > 0) {
      const upsertWallet = db.prepare(`
        INSERT INTO smart_wallets (address, username, pnl, volume, rank, profile_image, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ON CONFLICT(address) DO UPDATE SET
          username = excluded.username,
          pnl = excluded.pnl,
          volume = excluded.volume,
          rank = excluded.rank,
          profile_image = excluded.profile_image,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      `);
      const txn = db.transaction(() => {
        for (const w of leaderboard) {
          upsertWallet.run(
            w.address,
            w.username || null,
            w.pnl,
            w.volume,
            w.rank,
            w.profileImage || null
          );
        }
      });
      txn();
      console.info(`[smartMoney] Synced ${leaderboard.length} wallets`);
    }

    // Build a set of smart wallet addresses for cross-referencing
    const smartAddresses = new Set(
      (
        db.prepare(`SELECT address FROM smart_wallets`).all() as Array<{ address: string }>
      ).map((r) => r.address.toLowerCase())
    );

    // 2. Build event slug → id map for matching trades to our DB
    const eventsBySlug = new Map<string, { id: string; title: string; slug: string }>();
    const eventRows = db
      .prepare(`SELECT id, title, slug FROM events WHERE is_active = 1`)
      .all() as Array<{ id: string; title: string; slug: string }>;
    for (const e of eventRows) {
      eventsBySlug.set(e.slug, e);
    }

    const insertTrade = db.prepare(`
      INSERT OR IGNORE INTO whale_trades
        (wallet, condition_id, event_id, side, size, price, usdc_size, outcome, title, slug, timestamp, is_smart_wallet)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const storeTrades = (trades: Awaited<ReturnType<typeof fetchMarketTrades>>, smartOnly: boolean) => {
      let count = 0;
      for (const t of trades) {
        if (!t.wallet) continue;
        const isSmart = smartAddresses.has(t.wallet.toLowerCase());
        if (smartOnly && !isSmart) continue;

        const event = eventsBySlug.get(t.eventSlug) || eventsBySlug.get(t.slug);
        insertTrade.run(
          t.wallet,
          t.conditionId,
          event?.id || null,
          t.side,
          t.size,
          t.price,
          t.usdcSize,
          t.outcome,
          t.title,
          t.eventSlug || t.slug,
          t.timestamp,
          isSmart ? 1 : 0
        );
        count++;
      }
      return count;
    };

    // 3a. Fetch whale trades (>= $5000, all wallets)
    const whaleTrades = await fetchMarketTrades("", 5000);
    let totalTrades = 0;
    const txn = db.transaction(() => {
      totalTrades += storeTrades(whaleTrades, false);
    });
    txn();

    // 3b. Fetch lower-threshold trades (>= $1000), only keep smart wallet ones
    // This captures smart money activity that wouldn't meet the whale threshold
    const smartTrades = await fetchMarketTrades("", 1000);
    let smartTradeCount = 0;
    const txn2 = db.transaction(() => {
      smartTradeCount = storeTrades(smartTrades, true);
    });
    txn2();
    totalTrades += smartTradeCount;

    // 4. Cleanup trades older than 7 days
    db.prepare(
      `DELETE FROM whale_trades WHERE timestamp < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')`
    ).run();

    // 5. Sync leaderboard cache for all time periods
    await syncLeaderboardCache();

    console.info(
      `[smartMoney] Sync complete — ${leaderboard.length} wallets, ${totalTrades} trades (${smartTradeCount} smart)`
    );
  } catch (err) {
    console.error("[smartMoney] Sync error:", err);
    throw err; // re-throw so circuit breaker counts it
  }
  }, undefined).catch(() => {}); // swallow after breaker records
}

let startupTimer: ReturnType<typeof setTimeout> | null = null;

export function startSmartMoneySync() {
  if (syncTimer) return;
  console.info("[smartMoney] Starting smart money sync (5min trades + 1h full leaderboard)");

  // Full leaderboard sync on startup (after short delay), then every hour
  startupTimer = setTimeout(() => {
    startupTimer = null;
    runFullLeaderboardSync().then(() => runSmartMoneySync());
  }, 10_000);

  fullLeaderboardTimer = setInterval(() => {
    runFullLeaderboardSync();
  }, FULL_LEADERBOARD_INTERVAL);

  // Trade sync every 5 minutes
  syncTimer = setInterval(() => {
    runSmartMoneySync();
  }, SYNC_INTERVAL);
}

export function stopSmartMoneySync() {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (fullLeaderboardTimer) {
    clearInterval(fullLeaderboardTimer);
    fullLeaderboardTimer = null;
  }
  console.info("[smartMoney] Stopped smart money sync");
}
