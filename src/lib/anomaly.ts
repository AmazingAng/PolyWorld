import type Database from "better-sqlite3";
import type { AnomalyInfo } from "@/types";

/**
 * Detect price anomalies using Z-Score on 7-day rolling data.
 * Also detects volume spikes (volume > 3x rolling average).
 */
export function detectAnomalies(
  db: Database.Database,
  eventIds: string[]
): Map<string, AnomalyInfo> {
  const result = new Map<string, AnomalyInfo>();
  if (eventIds.length === 0) return result;

  // Query recent snapshots per event using a window to avoid full table scans.
  // We use a subquery with ROW_NUMBER to limit to 200 most recent per event.
  const placeholders = eventIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT event_id, prob, volume_24h, change FROM (
         SELECT event_id, prob, volume_24h, change,
                ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY recorded_at DESC) AS rn
         FROM price_snapshots
         WHERE event_id IN (${placeholders})
           AND recorded_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
       ) WHERE rn <= 200
       ORDER BY event_id, rn DESC`
    )
    .all(...eventIds) as Array<{
    event_id: string;
    prob: number | null;
    volume_24h: number | null;
    change: number | null;
  }>;

  // Group by event_id
  const groups = new Map<
    string,
    Array<{ prob: number | null; volume_24h: number | null; change: number | null }>
  >();
  for (const row of rows) {
    const arr = groups.get(row.event_id) || [];
    arr.push({ prob: row.prob, volume_24h: row.volume_24h, change: row.change });
    groups.set(row.event_id, arr);
  }

  for (const eventId of eventIds) {
    const snapshots = groups.get(eventId);
    if (!snapshots || snapshots.length < 3) continue; // need enough data

    // Compute mean/stddev of change values
    const changes = snapshots
      .map((s) => s.change)
      .filter((c): c is number => c !== null && !isNaN(c));

    if (changes.length < 3) continue;

    const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
    const variance =
      changes.reduce((a, b) => a + (b - mean) ** 2, 0) / changes.length;
    const stddev = Math.sqrt(variance);

    // Latest change
    const latestChange = changes[changes.length - 1];

    // Z-score
    const zScore = stddev > 0.001 ? (latestChange - mean) / stddev : 0;
    const isAnomaly = Math.abs(zScore) > 2;

    // Volume spike detection
    const volumes = snapshots
      .map((s) => s.volume_24h)
      .filter((v): v is number => v !== null && !isNaN(v));
    let volumeSpike = false;
    if (volumes.length >= 3) {
      const avgVol =
        volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
      const latestVol = volumes[volumes.length - 1];
      volumeSpike = avgVol > 0 && latestVol > avgVol * 3;
    }

    const direction: AnomalyInfo["direction"] =
      latestChange > 0.001 ? "up" : latestChange < -0.001 ? "down" : "neutral";

    if (isAnomaly || volumeSpike) {
      result.set(eventId, {
        zScore: Math.round(zScore * 10) / 10,
        isAnomaly,
        direction,
        volumeSpike,
      });
    }
  }

  return result;
}
