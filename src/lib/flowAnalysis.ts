import type Database from "better-sqlite3";

export interface CategoryFlow {
  category: string;
  netBuys: number;       // buy count - sell count
  netVolume: number;     // USD buy volume - sell volume
  smartRatio: number;    // smart wallet trade ratio
  trend: "bullish" | "bearish" | "neutral";
  hourlyFlow: Array<{ hour: string; netVolume: number }>;
}

interface FlowRow {
  category: string;
  buys: number;
  sells: number;
  net_volume: number;
  smart_count: number;
  total_count: number;
}

interface HourlyFlowRow {
  category: string;
  hour_bucket: string;
  net_volume: number;
}

/**
 * Aggregate whale trades by category to show sector-level flow direction and intensity.
 */
export function aggregateFlowByCategory(
  db: Database.Database,
  hoursBack = 24,
): CategoryFlow[] {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  // Main aggregation by category
  const rows = db
    .prepare(
      `SELECT e.category,
              SUM(CASE WHEN wt.side = 'BUY' THEN 1 ELSE 0 END) as buys,
              SUM(CASE WHEN wt.side = 'SELL' THEN 1 ELSE 0 END) as sells,
              SUM(CASE WHEN wt.side = 'BUY' THEN wt.usdc_size ELSE -wt.usdc_size END) as net_volume,
              SUM(CASE WHEN wt.is_smart_wallet = 1 THEN 1 ELSE 0 END) as smart_count,
              COUNT(*) as total_count
       FROM whale_trades wt
       JOIN events e ON wt.event_id = e.id
       WHERE wt.timestamp >= ?
       GROUP BY e.category
       ORDER BY ABS(SUM(CASE WHEN wt.side = 'BUY' THEN wt.usdc_size ELSE -wt.usdc_size END)) DESC`
    )
    .all(cutoff) as FlowRow[];

  if (rows.length === 0) return [];

  // Hourly breakdown for sparkline
  const hourlyRows = db
    .prepare(
      `SELECT e.category,
              strftime('%Y-%m-%dT%H:00:00Z', wt.timestamp) as hour_bucket,
              SUM(CASE WHEN wt.side = 'BUY' THEN wt.usdc_size ELSE -wt.usdc_size END) as net_volume
       FROM whale_trades wt
       JOIN events e ON wt.event_id = e.id
       WHERE wt.timestamp >= ?
       GROUP BY e.category, hour_bucket
       ORDER BY hour_bucket ASC`
    )
    .all(cutoff) as HourlyFlowRow[];

  // Group hourly data by category
  const hourlyMap = new Map<string, Array<{ hour: string; netVolume: number }>>();
  for (const r of hourlyRows) {
    let arr = hourlyMap.get(r.category);
    if (!arr) { arr = []; hourlyMap.set(r.category, arr); }
    arr.push({ hour: r.hour_bucket, netVolume: r.net_volume });
  }

  return rows.map((r) => {
    const netBuys = r.buys - r.sells;
    const smartRatio = r.total_count > 0 ? r.smart_count / r.total_count : 0;
    const buyRatio = (r.buys + r.sells) > 0 ? r.buys / (r.buys + r.sells) : 0.5;
    const trend: CategoryFlow["trend"] =
      buyRatio > 0.6 ? "bullish" : buyRatio < 0.4 ? "bearish" : "neutral";

    return {
      category: r.category || "Other",
      netBuys,
      netVolume: r.net_volume,
      smartRatio,
      trend,
      hourlyFlow: hourlyMap.get(r.category) || [],
    };
  });
}
