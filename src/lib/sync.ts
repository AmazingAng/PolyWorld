import { getDb } from "./db";
import { fetchEventsFromAPI, processEvents } from "./polymarket";
import type { ProcessedMarket, SmartMoneyFlow, WhaleTrade } from "@/types";
import { computeImpactScores } from "./impact";
import { detectAnomalies } from "./anomaly";
import { aiGeocodeBatch, addJitter } from "./aiGeo";
import { isAiConfigured } from "./ai";
import { geolocate } from "./geo";

const SYNC_INTERVAL = 30_000;

let syncTimer: ReturnType<typeof setInterval> | null = null;
let geocodeRunning = false;

// --- Caches for readMarketsFromDb ---
let resultCache: { data: { mapped: ProcessedMarket[]; unmapped: ProcessedMarket[] }; ts: number } | null = null;
const RESULT_CACHE_TTL = 10_000; // 10s

let anomalyCache: { data: Map<string, import("@/types").AnomalyInfo>; ts: number } | null = null;
const ANOMALY_CACHE_TTL = 120_000; // 2 min

let lastCleanup = Date.now(); // don't run cleanup on first sync
const CLEANUP_INTERVAL = 3600_000; // 1 hour

/** Fire-and-forget: geocode pending markets without blocking sync */
function geocodePending(db: ReturnType<typeof getDb>) {
  if (geocodeRunning) return;
  const ungeo = db
    .prepare(`SELECT id, title, description, location FROM events WHERE ai_geo_done = 0 LIMIT 25`)
    .all() as Array<{ id: string; title: string; description: string | null; location: string | null }>;
  if (ungeo.length === 0) return;

  const updateGeo = db.prepare(`
    UPDATE events SET lat = @lat, lng = @lng, location = @location,
      geo_city = @city, geo_country = @country, ai_geo_done = 1
    WHERE id = @id
  `);
  const markDone = db.prepare(`UPDATE events SET ai_geo_done = 1 WHERE id = ?`);

  const writeResults = (resultMap: Map<string, { id: string; lat: number | null; lng: number | null; location: string | null; city: string | null; country: string | null; confidence: number }> | null) => {
    try {
      const txn = db.transaction(() => {
        for (const market of ungeo) {
          let result = resultMap?.get(market.id);
          if (!result || (result.lat === null && result.lng === null)) {
            const geo = geolocate(market.title, market.description ?? undefined);
            if (geo) {
              const [jLat, jLng] = addJitter(geo.coords[0], geo.coords[1], market.id);
              result = { id: market.id, lat: jLat, lng: jLng, location: geo.location, city: null, country: null, confidence: 0.3 };
            }
          }
          if (result && result.lat !== null && result.lng !== null) {
            updateGeo.run({ id: market.id, lat: result.lat, lng: result.lng, location: result.location || market.location, city: result.city, country: result.country });
          } else {
            markDone.run(market.id);
          }
        }
      });
      txn();
    } catch { /* DB busy — will retry next cycle */ }
  };

  if (isAiConfigured()) {
    geocodeRunning = true;
    aiGeocodeBatch(ungeo.map((r) => ({ id: r.id, title: r.title, description: r.description, currentLocation: r.location })))
      .then((results) => writeResults(new Map(results.map((r) => [r.id, r]))))
      .catch(() => writeResults(null))
      .finally(() => { geocodeRunning = false; console.log(`[sync] Geocoded ${ungeo.length} markets`); });
  } else {
    writeResults(null);
    console.log(`[sync] Geocoded ${ungeo.length} markets (regex)`);
  }
}

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
        recent_change = @recentChange,
        location = CASE WHEN events.ai_geo_done = 1 THEN events.location ELSE @location END,
        lat = CASE WHEN events.ai_geo_done = 1 THEN events.lat ELSE @lat END,
        lng = CASE WHEN events.ai_geo_done = 1 THEN events.lng ELSE @lng END,
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

    // Mark stale events as closed — not in current API fetch means
    // the event is no longer active on Polymarket (closed, resolved, or delisted)
    const fetchedIds = new Set(all.map((m) => m.id));
    const staleRows = db
      .prepare(
        `SELECT id FROM events WHERE is_closed = 0`
      )
      .all() as Array<{ id: string }>;
    const staleIds = staleRows.filter((r) => !fetchedIds.has(r.id));
    if (staleIds.length > 0) {
      const markClosed = db.prepare(
        `UPDATE events SET is_closed = 1 WHERE id = ?`
      );
      const closeTxn = db.transaction(() => {
        for (const r of staleIds) markClosed.run(r.id);
      });
      closeTxn();
      console.log(`[sync] Marked ${staleIds.length} stale resolved events as closed`);
    }

    // Cleanup snapshots older than 30 days — run once per hour to avoid blocking
    if (Date.now() - lastCleanup > CLEANUP_INTERVAL) {
      db.prepare(
        `DELETE FROM price_snapshots WHERE recorded_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')`
      ).run();
      db.prepare(
        `DELETE FROM market_snapshots WHERE recorded_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')`
      ).run();
      lastCleanup = Date.now();
    }

    // Log sync
    db.prepare(
      `INSERT INTO sync_log (started_at, finished_at, event_count, status) VALUES (?, ?, ?, ?)`
    ).run(startedAt, new Date().toISOString(), all.length, "ok");

    // Invalidate read cache so next request picks up fresh data
    invalidateMarketCaches();

    // Geocode new markets — fire-and-forget to avoid blocking sync
    geocodePending(db);

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

/** Invalidate caches after a sync so next request gets fresh data */
function invalidateMarketCaches() {
  resultCache = null;
}

/** Trim sub-market objects to only the fields used by the frontend */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function trimMarket(m: any): any {
  return {
    id: m.id,
    question: m.question,
    groupItemTitle: m.groupItemTitle,
    clobTokenIds: m.clobTokenIds,
    outcomePrices: m.outcomePrices,
    outcomes: m.outcomes,
    oneDayPriceChange: m.oneDayPriceChange,
    active: m.active,
    volume: m.volume,
    volume_24hr: m.volume_24hr,
    liquidity: m.liquidity,
  };
}

export function readMarketsFromDb(): {
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
} {
  // Return cached result if fresh
  if (resultCache && Date.now() - resultCache.ts < RESULT_CACHE_TTL) {
    return resultCache.data;
  }

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, market_id, title, slug, category, volume, volume_24h, prob, change,
              recent_change, markets_json, location, lat, lng, created_at, description,
              resolution_source, end_date, image, liquidity, is_active, is_closed,
              comment_count, tags_json
       FROM events WHERE is_closed = 0 ORDER BY volume_24h DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const mapped: ProcessedMarket[] = [];
  const unmapped: ProcessedMarket[] = [];

  for (const row of rows) {
    let markets = [];
    try {
      const raw = JSON.parse((row.markets_json as string) || "[]");
      markets = Array.isArray(raw) ? raw.map(trimMarket) : [];
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
      closed: row.is_closed === 1
        || (markets.length > 0 && markets.every((mk: any) => mk.active === false)),
      commentCount: (row.comment_count as number) || 0,
      tags,
      impactScore: 0,
      impactLevel: "info",
    };

    if (item.coords) {
      mapped.push(item);
    } else {
      unmapped.push(item);
    }
  }

  // Compute impact scores
  const allMarkets = [...mapped, ...unmapped];
  const impactScores = computeImpactScores(allMarkets);
  for (const m of allMarkets) {
    const score = impactScores.get(m.id);
    if (score) {
      m.impactScore = score.impactScore;
      m.impactLevel = score.impactLevel;
    }
  }

  // Detect anomalies — use cache (2min TTL) to avoid slow 23M-row query
  try {
    if (!anomalyCache || Date.now() - anomalyCache.ts > ANOMALY_CACHE_TTL) {
      const top = [...allMarkets]
        .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
        .slice(0, 50);
      anomalyCache = {
        data: detectAnomalies(db, top.map((m) => m.id)),
        ts: Date.now(),
      };
    }
    for (const m of allMarkets) {
      const a = anomalyCache.data.get(m.id);
      if (a) m.anomaly = a;
    }
  } catch {
    // anomaly detection is non-critical
  }

  // Attach smart money flow indicators for top 50 markets
  try {
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const trades = db
      .prepare(
        `SELECT wallet, condition_id, event_id, side, size, price, usdc_size, outcome,
                title, slug, timestamp, is_smart_wallet
         FROM whale_trades WHERE timestamp >= ?
         ORDER BY timestamp DESC`
      )
      .all(cutoff24h) as Array<Record<string, unknown>>;

    // Group by event_id
    const byEvent = new Map<string, Array<Record<string, unknown>>>();
    for (const t of trades) {
      const eid = t.event_id as string;
      if (!eid) continue;
      if (!byEvent.has(eid)) byEvent.set(eid, []);
      byEvent.get(eid)!.push(t);
    }

    // Fetch smart wallet usernames for display
    const walletNames = new Map<string, string | null>();
    try {
      const wallets = db
        .prepare(`SELECT address, username FROM smart_wallets`)
        .all() as Array<{ address: string; username: string | null }>;
      for (const w of wallets) walletNames.set(w.address.toLowerCase(), w.username);
    } catch { /* ignore */ }

    for (const m of allMarkets) {
      const eventTrades = byEvent.get(m.id);
      if (!eventTrades || eventTrades.length === 0) continue;

      let smartBuys = 0, smartSells = 0, whaleBuys = 0, whaleSells = 0;
      const topWallets: SmartMoneyFlow["topWallets"] = [];
      const seenWallets = new Set<string>();

      for (const t of eventTrades) {
        const side = t.side as string;
        const isSmart = t.is_smart_wallet === 1;
        if (side === "BUY") {
          whaleBuys++;
          if (isSmart) smartBuys++;
        } else {
          whaleSells++;
          if (isSmart) smartSells++;
        }
        // Track top wallets (first occurrence per wallet)
        const addr = (t.wallet as string).toLowerCase();
        if (isSmart && !seenWallets.has(addr) && topWallets.length < 5) {
          seenWallets.add(addr);
          topWallets.push({
            address: t.wallet as string,
            username: walletNames.get(addr) || null,
            side: side as "BUY" | "SELL",
            size: t.usdc_size as number || t.size as number,
          });
        }
      }

      const buyRatio = whaleBuys / (whaleBuys + whaleSells || 1);
      const netFlow: SmartMoneyFlow["netFlow"] =
        buyRatio > 0.6 ? "bullish" : buyRatio < 0.4 ? "bearish" : "neutral";

      const recentTrades: WhaleTrade[] = eventTrades.slice(0, 5).map((t) => ({
        wallet: t.wallet as string,
        username: walletNames.get((t.wallet as string).toLowerCase()) || undefined,
        conditionId: t.condition_id as string,
        eventId: t.event_id as string | null,
        side: t.side as "BUY" | "SELL",
        size: t.size as number,
        price: t.price as number,
        usdcSize: t.usdc_size as number,
        outcome: t.outcome as string,
        title: t.title as string,
        slug: t.slug as string,
        timestamp: t.timestamp as string,
        isSmartWallet: t.is_smart_wallet === 1,
      }));

      m.smartMoney = {
        smartBuys,
        smartSells,
        whaleBuys,
        whaleSells,
        netFlow,
        topWallets,
        recentTrades,
      };
    }
  } catch {
    // smart money is non-critical
  }

  // Cache the result
  const data = { mapped, unmapped };
  resultCache = { data, ts: Date.now() };
  return data;
}
