import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { PolymarketMarket } from "@/types";

export const dynamic = "force-dynamic";

const CLOB_BASE = "https://clob.polymarket.com";

interface MarketSnapshotRow {
  market_id: string;
  label: string;
  prob: number;
  recorded_at: string;
}

/** Map hours → CLOB interval + fidelity (minutes) */
function clobParams(hours: number): { interval: string; fidelity: number } {
  if (hours <= 1) return { interval: "1h", fidelity: 1 };
  if (hours <= 6) return { interval: "6h", fidelity: 1 };
  if (hours <= 24) return { interval: "1d", fidelity: 5 };
  if (hours <= 168) return { interval: "1w", fidelity: 30 };
  return { interval: "max", fidelity: 120 };
}

/** Parse clobTokenIds field (may be JSON string or array) → Yes token ID */
function getYesTokenId(m: PolymarketMarket): string | null {
  const raw = m.clobTokenIds;
  if (!raw) return null;
  try {
    const arr: string[] = Array.isArray(raw) ? raw : JSON.parse(raw);
    return arr[0] || null;
  } catch {
    return null;
  }
}

/** Fetch price history from CLOB API for a single token */
async function fetchClobHistory(
  tokenId: string,
  hours: number,
): Promise<{ t: number; p: number }[]> {
  const { interval, fidelity } = clobParams(hours);
  const url = `${CLOB_BASE}/prices-history?market=${tokenId}&interval=${interval}&fidelity=${fidelity}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.history || []) as { t: number; p: number }[];
  } catch {
    return [];
  }
}

/** Store CLOB history points into market_snapshots, skip duplicates by timestamp */
function storeClobHistory(
  db: ReturnType<typeof getDb>,
  eventId: string,
  marketId: string,
  label: string,
  history: { t: number; p: number }[],
) {
  if (history.length === 0) return;

  // Get existing timestamps to avoid duplicates
  const existing = new Set(
    (db.prepare(
      `SELECT recorded_at FROM market_snapshots WHERE event_id = ? AND market_id = ?`
    ).all(eventId, marketId) as { recorded_at: string }[]).map(r => r.recorded_at)
  );

  const insert = db.prepare(
    `INSERT INTO market_snapshots (event_id, market_id, label, prob, recorded_at) VALUES (?, ?, ?, ?, ?)`
  );

  const txn = db.transaction(() => {
    for (const pt of history) {
      const ts = new Date(pt.t * 1000).toISOString();
      if (!existing.has(ts)) {
        insert.run(eventId, marketId, label, pt.p, ts);
      }
    }
  });
  txn();
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const eventId = searchParams.get("eventId");
  const hours = parseInt(searchParams.get("hours") || "24", 10);
  const perMarket = searchParams.get("perMarket") === "1";

  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const clampedHours = Math.min(Math.max(hours, 1), 720);
  const timeArg = `-${clampedHours} hours`;

  try {
    const db = getDb();

    if (perMarket) {
      // Check existing per-market data
      const rows = db
        .prepare(
          `SELECT market_id, label, prob, recorded_at
           FROM market_snapshots
           WHERE event_id = ? AND recorded_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
           ORDER BY recorded_at ASC`
        )
        .all(eventId, timeArg) as MarketSnapshotRow[];

      // If we have data, check if it's sufficient (at least 2 points per series)
      const seriesMap = new Map<string, { marketId: string; label: string; data: { prob: number; recorded_at: string }[] }>();
      for (const row of rows) {
        let s = seriesMap.get(row.market_id);
        if (!s) {
          s = { marketId: row.market_id, label: row.label, data: [] };
          seriesMap.set(row.market_id, s);
        }
        s.label = row.label;
        s.data.push({ prob: row.prob, recorded_at: row.recorded_at });
      }

      const validSeries = Array.from(seriesMap.values()).filter(s => s.data.length >= 2);

      // Check if stored data covers the requested range well enough
      if (validSeries.length > 0) {
        const windowStart = Date.now() - clampedHours * 3600_000;
        const oldestPoint = Math.min(
          ...validSeries.map(s => new Date(s.data[0].recorded_at).getTime())
        );
        const newestPoint = Math.max(
          ...validSeries.map(s => new Date(s.data[s.data.length - 1].recorded_at).getTime())
        );
        const coverageStart = (Date.now() - oldestPoint) / (clampedHours * 3600_000);
        // Stale = newest data point is more than 2 hours old
        const staleness = Date.now() - newestPoint;
        const isStale = staleness > 2 * 3600_000;
        if (!isStale && (coverageStart >= 0.5 || oldestPoint <= windowStart + 3600_000)) {
          return NextResponse.json({ series: validSeries });
        }
      }

      // Insufficient data — fetch from CLOB API
      // Look up event's markets_json to get sub-market info
      const eventRow = db.prepare(`SELECT markets_json FROM events WHERE id = ?`).get(eventId) as { markets_json: string } | undefined;
      if (!eventRow) {
        return NextResponse.json({ series: [] });
      }

      let markets: PolymarketMarket[] = [];
      try {
        markets = JSON.parse(eventRow.markets_json || "[]");
      } catch { /* skip */ }

      const activeMarkets = markets.filter(m => m.active !== false);
      if (activeMarkets.length === 0) {
        return NextResponse.json({ series: [] });
      }

      // Fetch CLOB history for each sub-market in parallel (limit concurrency)
      const BATCH = 5;
      const results: { market: PolymarketMarket; history: { t: number; p: number }[] }[] = [];

      for (let i = 0; i < activeMarkets.length; i += BATCH) {
        const batch = activeMarkets.slice(i, i + BATCH);
        const batchResults = await Promise.all(
          batch.map(async (m) => {
            const tokenId = getYesTokenId(m);
            if (!tokenId) return { market: m, history: [] };
            const history = await fetchClobHistory(tokenId, clampedHours);
            return { market: m, history };
          })
        );
        results.push(...batchResults);
      }

      // Store in DB and build response
      const newSeries: { marketId: string; label: string; data: { prob: number; recorded_at: string }[] }[] = [];

      for (const { market: m, history } of results) {
        if (history.length < 2) continue;
        const label = m.groupItemTitle || m.question || m.id;
        storeClobHistory(db, eventId, m.id, label, history);
        newSeries.push({
          marketId: m.id,
          label,
          data: history.map(pt => ({
            prob: pt.p,
            recorded_at: new Date(pt.t * 1000).toISOString(),
          })),
        });
      }

      return NextResponse.json({ series: newSeries });
    }

    // Default: event-level snapshots (backward compatible)
    const rows = db
      .prepare(
        `SELECT prob, volume_24h, change, recorded_at
         FROM price_snapshots
         WHERE event_id = ? AND recorded_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
         ORDER BY recorded_at ASC`
      )
      .all(eventId, timeArg);

    return NextResponse.json(rows);
  } catch (err) {
    console.error("[api/snapshots] Error:", err);
    return NextResponse.json([], { status: 500 });
  }
}
