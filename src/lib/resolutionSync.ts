import RssParser from "rss-parser";
import { getDb } from "./db";
import { parseResolutionSource } from "./resolutionSources";
import { extractKeywords } from "./keywords";
import {
  fetchPrice,
  parseThresholdFromTitle,
  parseThresholdsFromOutcomes,
  checkPriceProximity,
  formatPriceAlertTitle,
  getCandleDirection,
  type PriceThreshold,
} from "./priceMonitor";
import { RESOLUTION_SYNC_MS } from "./syncIntervals";

const parser = new RssParser({ timeout: 10_000 });
const RESOLUTION_SYNC_INTERVAL = RESOLUTION_SYNC_MS;

/** Generic sport terms that appear in nearly every article of a sport-specific RSS feed */
const SPORTS_STOP_WORDS = new Set([
  "grand", "prix", "formula", "race", "racing", "championship", "league",
  "premier", "division", "tournament", "trophy", "award", "winner",
  "match", "game", "season", "round", "final", "finals", "semi",
  "quarter", "play", "plays", "player", "players", "team", "teams",
  "coach", "sport", "sports", "club", "score", "scores", "point", "points",
  "goal", "goals", "assist", "assists", "stats", "standings",
  "transfer", "transfers", "injury", "injuries", "debut",
]);

interface MonitorRow {
  event_id: string;
  source_type: string;
  feed_url: string | null;
  org_name: string | null;
  monitor_config: string | null;
  last_checked_at: string | null;
  check_count: number;
}

interface EventRow {
  id: string;
  title: string;
  resolution_source: string | null;
  end_date: string | null;
  tags_json: string;
  markets_json: string;
}

type EnrichedMonitor = MonitorRow & { title: string; end_date: string | null; tags_json: string; markets_json: string };

// ── Priority filter: more urgent markets checked more often ──

function shouldCheck(m: { end_date: string | null; check_count: number }): boolean {
  const now = Date.now();
  const endTime = m.end_date ? new Date(m.end_date).getTime() : Infinity;
  const hoursUntilEnd = (endTime - now) / 3600_000;
  const count = m.check_count || 0;

  if (hoursUntilEnd <= 24) return true;            // every 2min
  if (hoursUntilEnd <= 168) return count % 2 === 0; // every 4min
  return count % 5 === 0;                           // every 10min
}

// ── Main sync function ──

export async function runResolutionSync(): Promise<{ monitors: number; alerts: number }> {
  const db = getDb();
  let totalAlerts = 0;

  // 1. Build/refresh monitor list from all active events with resolution_source
  const events = db.prepare(`
    SELECT id, title, resolution_source, end_date, tags_json, markets_json
    FROM events
    WHERE is_active = 1 AND is_closed = 0 AND resolution_source IS NOT NULL
  `).all() as EventRow[];

  const upsertMonitor = db.prepare(`
    INSERT INTO resolution_monitors (event_id, source_type, feed_url, org_name, monitor_config)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      source_type = excluded.source_type,
      feed_url = excluded.feed_url,
      org_name = excluded.org_name,
      monitor_config = excluded.monitor_config
  `);

  const upsertTx = db.transaction(() => {
    for (const event of events) {
      const target = parseResolutionSource(event.resolution_source);
      switch (target.type) {
        case "known_feed":
          upsertMonitor.run(event.id, target.type, target.feedUrl, target.orgName, null);
          break;
        case "price_feed": {
          const config = JSON.stringify({ provider: target.provider, symbol: target.symbol });
          upsertMonitor.run(event.id, target.type, target.url, target.provider, config);
          break;
        }
        case "sports_feed":
          upsertMonitor.run(event.id, target.type, target.feedUrl, target.source, null);
          break;
        default:
          upsertMonitor.run(event.id, "unmonitorable", null, null, null);
      }
    }
  });
  upsertTx();

  // 2. Get all monitorable types
  const allMonitors = db.prepare(`
    SELECT rm.*, e.title, e.end_date, e.tags_json, e.markets_json
    FROM resolution_monitors rm
    JOIN events e ON e.id = rm.event_id
    WHERE rm.source_type IN ('known_feed', 'price_feed', 'sports_feed')
      AND e.is_active = 1 AND e.is_closed = 0
  `).all() as EnrichedMonitor[];

  const feedMonitors = allMonitors.filter((m) => m.source_type === "known_feed" || m.source_type === "sports_feed");
  const priceMonitors = allMonitors.filter((m) => m.source_type === "price_feed");

  // 3a. RSS-based monitoring (known_feed + sports_feed)
  totalAlerts += await runRssMonitoring(feedMonitors);

  // 3b. Price-based monitoring
  totalAlerts += await runPriceMonitoring(priceMonitors);

  // 4. Cleanup
  cleanup(db);

  const monitorable = allMonitors.length;
  console.info(
    `[resolutionSync] OK — ${monitorable} monitors (${feedMonitors.length} RSS, ${priceMonitors.length} price), ${totalAlerts} new alerts`
  );
  return { monitors: monitorable, alerts: totalAlerts };
}

// ── RSS monitoring (known_feed + sports_feed) ──

async function runRssMonitoring(monitors: EnrichedMonitor[]): Promise<number> {
  const toCheck = monitors.filter(shouldCheck);
  if (toCheck.length === 0) return 0;

  // Dedupe by feed URL
  const feedToMonitors = new Map<string, EnrichedMonitor[]>();
  for (const m of toCheck) {
    if (!m.feed_url) continue;
    if (!feedToMonitors.has(m.feed_url)) feedToMonitors.set(m.feed_url, []);
    feedToMonitors.get(m.feed_url)!.push(m);
  }

  const cutoff2h = new Date(Date.now() - 2 * 3600_000).toISOString();

  const feedResults = await Promise.allSettled(
    Array.from(feedToMonitors.keys()).map(async (feedUrl) => {
      const feed = await parser.parseURL(feedUrl);
      return { feedUrl, feed };
    })
  );

  let alerts = 0;
  const db = getDb();
  const upsertAlert = db.prepare(`
    INSERT INTO resolution_alerts (event_id, title, url, source)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(event_id, url) DO NOTHING
  `);
  const updateMonitor = db.prepare(`
    UPDATE resolution_monitors
    SET last_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        check_count = check_count + 1
    WHERE event_id = ?
  `);
  const alertTx = db.transaction(() => {
    for (const result of feedResults) {
      if (result.status !== "fulfilled") continue;
      const { feedUrl, feed } = result.value;
      const relatedMonitors = feedToMonitors.get(feedUrl) || [];

      const recentItems = (feed.items || []).filter((item) => {
        const pubDate = item.isoDate || item.pubDate;
        if (!pubDate) return false;
        return new Date(pubDate).toISOString() >= cutoff2h;
      });

      for (const monitor of relatedMonitors) {
        const isSports = monitor.source_type === "sports_feed";

        // For sports: only use title keywords (tags like "Formula 1", "Grand Prix" are too generic)
        // For news: include tags for broader matching
        let rawText: string;
        if (isSports) {
          rawText = monitor.title;
        } else {
          const tags: string[] = (() => {
            try { return JSON.parse(monitor.tags_json || "[]"); } catch { return []; }
          })();
          rawText = [monitor.title, ...tags].join(" ");
        }
        const allKeywords = [...new Set(extractKeywords(rawText))];
        // Filter out generic sport terms that match every article in a sport-specific feed
        const marketKeywords = isSports
          ? allKeywords.filter((kw) => !SPORTS_STOP_WORDS.has(kw))
          : allKeywords;
        if (marketKeywords.length < 2) continue;

        // Sports feeds need stricter matching to avoid false positives
        const minHits = isSports ? 3 : 2;
        const minRate = isSports ? 0.3 : 0;

        for (const item of recentItems) {
          if (!item.title || !item.link) continue;
          const articleText = (item.title + " " + (item.contentSnippet || "")).toLowerCase();
          const articleWords = new Set(extractKeywords(articleText));
          const hits = marketKeywords.filter((kw) => articleWords.has(kw));
          const matchRate = hits.length / marketKeywords.length;

          if (hits.length >= minHits && matchRate >= minRate) {
            upsertAlert.run(monitor.event_id, item.title.trim(), item.link, monitor.org_name || "Unknown");
            alerts++;
          }
        }

        updateMonitor.run(monitor.event_id);
      }
    }
  });
  alertTx();
  return alerts;
}

// ── Price monitoring ──

async function runPriceMonitoring(monitors: EnrichedMonitor[]): Promise<number> {
  const toCheck = monitors.filter(shouldCheck);
  if (toCheck.length === 0) return 0;

  // Dedupe price fetches by (provider, symbol)
  const priceKeys = new Map<string, { provider: string; symbol: string }>();
  for (const m of toCheck) {
    try {
      const config = JSON.parse(m.monitor_config || "{}");
      const key = `${config.provider}:${config.symbol}`;
      if (!priceKeys.has(key)) priceKeys.set(key, config);
    } catch { /* skip */ }
  }

  // Fetch all unique prices in parallel
  const prices = new Map<string, number>();
  const fetchResults = await Promise.allSettled(
    Array.from(priceKeys.entries()).map(async ([key, { provider, symbol }]) => {
      const price = await fetchPrice(provider, symbol);
      return { key, price };
    })
  );
  for (const result of fetchResults) {
    if (result.status === "fulfilled" && result.value.price !== null) {
      prices.set(result.value.key, result.value.price);
    }
  }

  let alerts = 0;
  const db = getDb();
  const upsertAlert = db.prepare(`
    INSERT INTO resolution_alerts (event_id, title, url, source)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(event_id, url) DO NOTHING
  `);
  const updateMonitor = db.prepare(`
    UPDATE resolution_monitors
    SET last_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        check_count = check_count + 1
    WHERE event_id = ?
  `);

  // Cooldown: only alert if last alert for this event was >1h ago
  const recentAlertEvents = new Set<string>();
  const recentRows = db.prepare(`
    SELECT DISTINCT event_id FROM resolution_alerts
    WHERE detected_at > datetime('now', '-1 hour')
  `).all() as Array<{ event_id: string }>;
  for (const r of recentRows) recentAlertEvents.add(r.event_id);

  // Collect Up/Down monitors for async candle direction check after the transaction
  const upDownMonitors: Array<{ monitor: EnrichedMonitor; config: { provider: string; symbol: string } }> = [];

  const alertTx = db.transaction(() => {
    for (const monitor of toCheck) {
      let config: { provider: string; symbol: string };
      try {
        config = JSON.parse(monitor.monitor_config || "{}");
      } catch { continue; }

      const key = `${config.provider}:${config.symbol}`;
      const currentPrice = prices.get(key);
      if (currentPrice === undefined) {
        updateMonitor.run(monitor.event_id);
        continue;
      }

      // Parse thresholds from title and outcomes
      const thresholds: PriceThreshold[] = [];
      const titleThreshold = parseThresholdFromTitle(monitor.title);
      if (titleThreshold) thresholds.push(titleThreshold);
      const outcomeThresholds = parseThresholdsFromOutcomes(monitor.markets_json || "[]");
      thresholds.push(...outcomeThresholds);

      if (thresholds.length === 0) {
        // "Up or Down" markets — track candle direction for Binance symbols
        if (config.provider === "binance" && /up or down/i.test(monitor.title)) {
          upDownMonitors.push({ monitor, config });
        }
        updateMonitor.run(monitor.event_id);
        continue;
      }

      // Skip if recently alerted (1h cooldown)
      if (recentAlertEvents.has(monitor.event_id)) {
        updateMonitor.run(monitor.event_id);
        continue;
      }

      const priceAlerts = checkPriceProximity(
        monitor.event_id,
        currentPrice,
        thresholds,
        config.symbol,
        config.provider,
      );

      // Insert the most relevant alert (closest to threshold)
      if (priceAlerts.length > 0) {
        const best = priceAlerts.sort((a, b) => a.distancePercent - b.distancePercent)[0];
        const alertTitle = formatPriceAlertTitle(best);
        const alertUrl = monitor.feed_url || `https://www.google.com/finance/quote/${config.symbol}`;
        upsertAlert.run(monitor.event_id, alertTitle, alertUrl, config.provider);
        alerts++;
      }

      updateMonitor.run(monitor.event_id);
    }
  });
  alertTx();

  // Process Up/Down markets: fetch candle direction and alert on strong moves (>2%)
  if (upDownMonitors.length > 0) {
    // Dedupe by symbol
    const symbolSet = new Set(upDownMonitors.map((m) => m.config.symbol));
    const directions = new Map<string, Awaited<ReturnType<typeof getCandleDirection>>>();
    const dirResults = await Promise.allSettled(
      Array.from(symbolSet).map(async (symbol) => {
        const dir = await getCandleDirection(symbol);
        return { symbol, dir };
      })
    );
    for (const r of dirResults) {
      if (r.status === "fulfilled" && r.value.dir) {
        directions.set(r.value.symbol, r.value.dir);
      }
    }

    const upDownTx = db.transaction(() => {
      for (const { monitor, config } of upDownMonitors) {
        if (recentAlertEvents.has(monitor.event_id)) continue;

        const candle = directions.get(config.symbol);
        if (!candle) continue;

        // Only alert on significant moves (>2%) to avoid noise
        if (Math.abs(candle.changePercent) < 2) continue;

        const sign = candle.changePercent > 0 ? "+" : "";
        const dir = candle.direction.toUpperCase();
        const alertTitle = `${config.symbol} trending ${dir} (${sign}${candle.changePercent}%) — open $${candle.openPrice.toLocaleString("en-US")} → now $${candle.currentPrice.toLocaleString("en-US")}`;
        const alertUrl = monitor.feed_url || `https://www.binance.com/en/trade/${config.symbol.replace("USDT", "_USDT")}`;
        upsertAlert.run(monitor.event_id, alertTitle, alertUrl, "binance");
        alerts++;
      }
    });
    upDownTx();
  }

  return alerts;
}

// ── Cleanup ──

function cleanup(db: ReturnType<typeof getDb>) {
  db.prepare(`
    DELETE FROM resolution_monitors
    WHERE event_id NOT IN (SELECT id FROM events WHERE is_active = 1 AND is_closed = 0)
  `).run();
  db.prepare(`DELETE FROM resolution_alerts WHERE detected_at < datetime('now', '-7 days')`).run();
}

// ── Read helpers (API) ──

export interface ResolutionAlertRow {
  id: number;
  event_id: string;
  title: string;
  url: string;
  source: string;
  detected_at: string;
  dismissed: number;
  market_title: string;
  slug: string;
  prob: number | null;
  end_date: string | null;
  category: string | null;
}

export function readResolutionAlerts(marketId?: string): ResolutionAlertRow[] {
  const db = getDb();
  if (marketId) {
    return db.prepare(`
      SELECT ra.*, e.title AS market_title, e.slug, e.prob, e.end_date, e.category
      FROM resolution_alerts ra
      JOIN events e ON e.id = ra.event_id
      WHERE ra.event_id = ? AND ra.dismissed = 0
      ORDER BY ra.detected_at DESC
      LIMIT 20
    `).all(marketId) as ResolutionAlertRow[];
  }
  return db.prepare(`
    SELECT ra.*, e.title AS market_title, e.slug, e.prob, e.end_date, e.category
    FROM resolution_alerts ra
    JOIN events e ON e.id = ra.event_id
    WHERE ra.dismissed = 0 AND ra.detected_at > datetime('now', '-24 hours')
    ORDER BY ra.detected_at DESC
    LIMIT 50
  `).all() as ResolutionAlertRow[];
}

export function getMonitorStatus(eventId: string): { sourceType: string; lastCheckedAt: string | null } | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT source_type, last_checked_at FROM resolution_monitors WHERE event_id = ?
  `).get(eventId) as { source_type: string; last_checked_at: string | null } | undefined;
  return row ? { sourceType: row.source_type, lastCheckedAt: row.last_checked_at } : null;
}

// ── Sync loop ──

let syncTimer: ReturnType<typeof setInterval> | null = null;

export function startResolutionSyncLoop() {
  if (syncTimer) return;
  runResolutionSync().catch((err) => console.error("[resolutionSync] initial sync error:", err));
  syncTimer = setInterval(() => {
    runResolutionSync().catch((err) => console.error("[resolutionSync] sync error:", err));
  }, RESOLUTION_SYNC_INTERVAL);
}

export function stopResolutionSyncLoop() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.info("[resolutionSync] Stopped resolution sync loop");
  }
}
