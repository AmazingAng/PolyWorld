import type Database from "better-sqlite3";
import type { MarketIndicators } from "@/types";

/** Cache for indicators — 5 min TTL aligned with anomaly detection */
let indicatorCache: { data: Map<string, MarketIndicators>; ts: number } | null = null;
const INDICATOR_CACHE_TTL = 300_000; // 5 min

/**
 * Compute momentum, volatility, and order flow imbalance for a set of markets.
 *
 * - **momentum**: acceleration of price change = (current_change - change_6h_ago)
 * - **volatility**: standard deviation of prob values over the last 24h
 * - **orderFlowImbalance**: (smartBuys - smartSells) / total from whale_trades
 */
export function computeIndicators(
  db: Database.Database,
  eventIds: string[],
): Map<string, MarketIndicators> {
  // Return cache if fresh
  if (indicatorCache && Date.now() - indicatorCache.ts < INDICATOR_CACHE_TTL) {
    return indicatorCache.data;
  }

  const result = new Map<string, MarketIndicators>();
  if (eventIds.length === 0) return result;

  const placeholders = eventIds.map(() => "?").join(",");

  // --- Momentum & Volatility from price_snapshots ---
  const snapRows = db
    .prepare(
      `SELECT event_id, prob, change, recorded_at FROM (
         SELECT event_id, prob, change, recorded_at,
                ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY recorded_at DESC) AS rn
         FROM price_snapshots
         WHERE event_id IN (${placeholders})
           AND recorded_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')
       ) WHERE rn <= 300
       ORDER BY event_id, recorded_at ASC`
    )
    .all(...eventIds) as Array<{
    event_id: string;
    prob: number | null;
    change: number | null;
    recorded_at: string;
  }>;

  // Group by event_id
  const snapGroups = new Map<string, typeof snapRows>();
  for (const row of snapRows) {
    let arr = snapGroups.get(row.event_id);
    if (!arr) { arr = []; snapGroups.set(row.event_id, arr); }
    arr.push(row);
  }

  // --- Order flow from whale_trades ---
  const tradeRows = db
    .prepare(
      `SELECT event_id,
              SUM(CASE WHEN side = 'BUY' AND is_smart_wallet = 1 THEN 1 ELSE 0 END) as smart_buys,
              SUM(CASE WHEN side = 'SELL' AND is_smart_wallet = 1 THEN 1 ELSE 0 END) as smart_sells,
              COUNT(*) as total
       FROM whale_trades
       WHERE event_id IN (${placeholders})
         AND timestamp >= datetime('now', '-24 hours')
       GROUP BY event_id`
    )
    .all(...eventIds) as Array<{
    event_id: string;
    smart_buys: number;
    smart_sells: number;
    total: number;
  }>;

  const flowMap = new Map<string, { smartBuys: number; smartSells: number; total: number }>();
  for (const r of tradeRows) {
    flowMap.set(r.event_id, { smartBuys: r.smart_buys, smartSells: r.smart_sells, total: r.total });
  }

  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;

  for (const eventId of eventIds) {
    const snaps = snapGroups.get(eventId);
    const flow = flowMap.get(eventId);

    let momentum: number | null = null;
    let volatility: number | null = null;
    let orderFlowImbalance: number | null = null;

    if (snaps && snaps.length >= 2) {
      // Momentum: latest change - earliest change within window
      const latestChange = snaps[snaps.length - 1].change;
      // Find snapshot closest to 6h ago
      let oldChange: number | null = null;
      for (const s of snaps) {
        if (new Date(s.recorded_at).getTime() <= sixHoursAgo && s.change !== null) {
          oldChange = s.change;
        }
      }
      if (oldChange === null && snaps[0].change !== null) {
        oldChange = snaps[0].change; // fallback to earliest available
      }
      if (latestChange !== null && oldChange !== null) {
        momentum = latestChange - oldChange;
      }

      // Volatility: std dev of prob values
      const probs = snaps.map((s) => s.prob).filter((p): p is number => p !== null);
      if (probs.length >= 3) {
        const mean = probs.reduce((a, b) => a + b, 0) / probs.length;
        const variance = probs.reduce((a, b) => a + (b - mean) ** 2, 0) / probs.length;
        volatility = Math.sqrt(variance);
      }
    }

    // Order flow imbalance
    if (flow && flow.total > 0) {
      orderFlowImbalance = (flow.smartBuys - flow.smartSells) / flow.total;
    }

    if (momentum !== null || volatility !== null || orderFlowImbalance !== null) {
      result.set(eventId, { momentum, volatility, orderFlowImbalance });
    }
  }

  indicatorCache = { data: result, ts: Date.now() };
  return result;
}
