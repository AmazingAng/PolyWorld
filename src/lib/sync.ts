import { getDb } from "./db";
import { fetchEventsFromAPI, processEvents } from "./polymarket";
import type { ProcessedMarket } from "@/types";

const SYNC_INTERVAL = 30_000;

let syncTimer: ReturnType<typeof setInterval> | null = null;

export async function runSync(): Promise<{
  eventCount: number;
  status: string;
}> {
  const db = getDb();
  const startedAt = new Date().toISOString();

  try {
    const events = await fetchEventsFromAPI();
    const { mapped, unmapped } = processEvents(events);
    const all = [...mapped, ...unmapped];

    const upsert = db.prepare(`
      INSERT INTO events (id, market_id, title, slug, category, volume, volume_24h, prob, change, recent_change, location, lat, lng, markets_json, created_at, updated_at,
        description, resolution_source, end_date, image, liquidity, is_active, is_closed, comment_count, tags_json)
      VALUES (@id, @marketId, @title, @slug, @category, @volume, @volume24h, @prob, @change, @recentChange, @location, @lat, @lng, @marketsJson, @updatedAt, @updatedAt,
        @description, @resolutionSource, @endDate, @image, @liquidity, @isActive, @isClosed, @commentCount, @tagsJson)
      ON CONFLICT(id) DO UPDATE SET
        market_id = @marketId, title = @title, slug = @slug, category = @category,
        volume = @volume, volume_24h = @volume24h, prob = @prob, change = @change,
        recent_change = @recentChange, location = @location, lat = @lat, lng = @lng,
        markets_json = @marketsJson, updated_at = @updatedAt,
        description = @description, resolution_source = @resolutionSource, end_date = @endDate,
        image = @image, liquidity = @liquidity, is_active = @isActive, is_closed = @isClosed,
        comment_count = @commentCount, tags_json = @tagsJson
    `);

    const insertSnapshot = db.prepare(`
      INSERT INTO price_snapshots (event_id, prob, volume_24h, change)
      VALUES (?, ?, ?, ?)
    `);

    const insertMarketSnapshot = db.prepare(`
      INSERT INTO market_snapshots (event_id, market_id, label, prob)
      VALUES (?, ?, ?, ?)
    `);

    const now = new Date().toISOString();

    const txn = db.transaction(() => {
      for (const m of all) {
        upsert.run({
          id: m.id,
          marketId: m.marketId,
          title: m.title,
          slug: m.slug,
          category: m.category,
          volume: m.volume,
          volume24h: m.volume24h,
          prob: m.prob,
          change: m.change,
          recentChange: m.recentChange,
          location: m.location,
          lat: m.coords?.[0] ?? null,
          lng: m.coords?.[1] ?? null,
          marketsJson: JSON.stringify(m.markets || []),
          updatedAt: now,
          description: m.description,
          resolutionSource: m.resolutionSource,
          endDate: m.endDate,
          image: m.image,
          liquidity: m.liquidity,
          isActive: m.active ? 1 : 0,
          isClosed: m.closed ? 1 : 0,
          commentCount: m.commentCount,
          tagsJson: JSON.stringify(m.tags || []),
        });

        insertSnapshot.run(m.id, m.prob, m.volume24h, m.change);

        // Per-sub-market snapshots for multi-option charts
        for (const sub of m.markets || []) {
          if (sub.active === false) continue;
          let yesPrice: number | null = null;
          try {
            const raw = sub.outcomePrices
              ? Array.isArray(sub.outcomePrices) ? sub.outcomePrices : JSON.parse(sub.outcomePrices as string)
              : null;
            if (raw) yesPrice = parseFloat(raw[0]);
          } catch { /* skip */ }
          if (yesPrice != null && !isNaN(yesPrice)) {
            const label = sub.groupItemTitle || sub.question || sub.id;
            insertMarketSnapshot.run(m.id, sub.id, label, yesPrice);
          }
        }
      }
    });
    txn();

    // Cleanup snapshots older than 30 days
    db.prepare(
      `DELETE FROM price_snapshots WHERE recorded_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')`
    ).run();
    db.prepare(
      `DELETE FROM market_snapshots WHERE recorded_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')`
    ).run();

    // Log sync
    db.prepare(
      `INSERT INTO sync_log (started_at, finished_at, event_count, status) VALUES (?, ?, ?, ?)`
    ).run(startedAt, new Date().toISOString(), all.length, "ok");

    console.log(`[sync] OK — ${all.length} events (${mapped.length} mapped)`);
    return { eventCount: all.length, status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sync] FAIL — ${msg}`);

    try {
      db.prepare(
        `INSERT INTO sync_log (started_at, finished_at, event_count, status, error_msg) VALUES (?, ?, ?, ?, ?)`
      ).run(startedAt, new Date().toISOString(), 0, "error", msg);
    } catch {
      // ignore logging failure
    }

    return { eventCount: 0, status: "error" };
  }
}

export function startSyncLoop() {
  if (syncTimer) return;
  console.log("[sync] Starting sync loop (30s interval)");

  // Run immediately
  runSync();

  syncTimer = setInterval(() => {
    runSync();
  }, SYNC_INTERVAL);
}

export function readMarketsFromDb(): {
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
} {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM events ORDER BY volume_24h DESC`)
    .all() as Array<Record<string, unknown>>;

  const mapped: ProcessedMarket[] = [];
  const unmapped: ProcessedMarket[] = [];

  for (const row of rows) {
    let markets = [];
    try {
      markets = JSON.parse((row.markets_json as string) || "[]");
    } catch {
      // ignore
    }

    let tags: string[] = [];
    try {
      tags = JSON.parse((row.tags_json as string) || "[]");
    } catch {
      // ignore
    }

    const item: ProcessedMarket = {
      id: row.id as string,
      marketId: row.market_id as string,
      title: row.title as string,
      slug: row.slug as string,
      category: row.category as ProcessedMarket["category"],
      volume: row.volume as number,
      volume24h: row.volume_24h as number,
      prob: row.prob as number | null,
      change: row.change as number | null,
      recentChange: row.recent_change as number | null,
      markets,
      location: row.location as string | null,
      coords:
        row.lat != null && row.lng != null
          ? [row.lat as number, row.lng as number]
          : null,
      createdAt: (row.created_at as string) || null,
      description: (row.description as string) || null,
      resolutionSource: (row.resolution_source as string) || null,
      endDate: (row.end_date as string) || null,
      image: (row.image as string) || null,
      liquidity: (row.liquidity as number) || 0,
      active: row.is_active !== 0,
      closed: row.is_closed === 1,
      commentCount: (row.comment_count as number) || 0,
      tags,
    };

    if (item.coords) {
      mapped.push(item);
    } else {
      unmapped.push(item);
    }
  }

  return { mapped, unmapped };
}
