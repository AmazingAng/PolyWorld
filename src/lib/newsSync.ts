import crypto from "crypto";
import RssParser from "rss-parser";
import { getDb } from "./db";
import { NEWS_SOURCES } from "./newsSources";
import { isAiConfigured, matchNewsToMarkets } from "./ai";
import { extractKeywords } from "./keywords";
import type { NewsItem } from "@/types";
import { NEWS_SYNC_MS } from "./syncIntervals";

const parser = new RssParser({ timeout: 10_000 });
const NEWS_SYNC_INTERVAL = NEWS_SYNC_MS;

const MAX_MATCHES_PER_ITEM = 20; // limit matches per news/tweet to prevent explosion

function makeId(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);
}

export async function runNewsSync(): Promise<{ items: number; matches: number }> {
  const db = getDb();
  let totalItems = 0;
  let totalMatches = 0;

  const results = await Promise.allSettled(
    NEWS_SOURCES.map(async (source) => {
      const feed = await parser.parseURL(source.feedUrl);
      return { source, feed };
    })
  );

  const upsertStmt = db.prepare(`
    INSERT INTO news_items (id, title, url, source, source_url, summary, published_at, image_url, categories_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      published_at = excluded.published_at,
      image_url = excluded.image_url,
      categories_json = excluded.categories_json
  `);

  const insertTx = db.transaction(() => {
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { source, feed } = result.value;
      const items = (feed.items || []).slice(0, 20);

      for (const item of items) {
        if (!item.link || !item.title) continue;
        const id = makeId(item.link);
        const publishedAt = item.isoDate || item.pubDate
          ? new Date(item.isoDate || item.pubDate!).toISOString()
          : new Date().toISOString();
        const mediaThumb = (item as Record<string, unknown>)["media:thumbnail"];
        const imageUrl = item.enclosure?.url
          || (mediaThumb && typeof mediaThumb === "object" && (mediaThumb as Record<string, Record<string, string>>)["$"]?.url)
          || null;
        const categories = (item.categories || []).map((c: string | Record<string, string>) =>
          typeof c === "string" ? c : c._ || c.term || String(c)
        );

        upsertStmt.run(
          id,
          item.title.trim(),
          item.link,
          source.name,
          source.feedUrl,
          item.contentSnippet?.slice(0, 500) || item.content?.slice(0, 500) || null,
          publishedAt,
          imageUrl,
          JSON.stringify(categories),
        );
        totalItems++;
      }
    }
  });
  insertTx();

  totalMatches = runKeywordMatching(db);

  // AI semantic matching for zero-match news items
  if (isAiConfigured()) {
    try {
      totalMatches += await runAiMatching(db);
    } catch (err) {
      console.error("[newsSync] AI matching error:", err);
    }
  }

  // Cleanup: remove items older than 7 days
  db.prepare(`DELETE FROM news_items WHERE published_at < datetime('now', '-7 days')`).run();
  db.prepare(`DELETE FROM news_market_matches WHERE news_id NOT IN (SELECT id FROM news_items)`).run();

  console.info(`[newsSync] OK - ${totalItems} items, ${totalMatches} matches`);
  return { items: totalItems, matches: totalMatches };
}

function runKeywordMatching(db: ReturnType<typeof getDb>): number {
  const markets = db.prepare(`
    SELECT id, title, tags_json, location FROM events WHERE is_active = 1 AND is_closed = 0
  `).all() as Array<{ id: string; title: string; tags_json: string; location: string | null }>;

  if (markets.length === 0) return 0;

  // Build keyword sets per market
  const marketKeywords: Array<{ id: string; keywords: string[] }> = markets.map((m) => {
    const tags: string[] = (() => {
      try { return JSON.parse(m.tags_json || "[]"); } catch { return []; }
    })();
    const raw = [m.title, ...tags, m.location || ""].join(" ");
    const keywords = [...new Set(extractKeywords(raw))];
    return { id: m.id, keywords };
  });

  // Only match news items that haven't been matched yet (incremental)
  const newsItems = db.prepare(`
    SELECT id, title, summary, categories_json FROM news_items
    WHERE published_at > datetime('now', '-3 days')
      AND id NOT IN (SELECT DISTINCT news_id FROM news_market_matches)
  `).all() as Array<{ id: string; title: string; summary: string | null; categories_json: string }>;

  if (newsItems.length === 0) return 0;

  const upsertMatch = db.prepare(`
    INSERT INTO news_market_matches (news_id, market_id, relevance_score, match_method)
    VALUES (?, ?, ?, 'keyword')
    ON CONFLICT(news_id, market_id) DO UPDATE SET
      relevance_score = MAX(excluded.relevance_score, news_market_matches.relevance_score)
  `);

  let matches = 0;
  const matchTx = db.transaction(() => {
    for (const news of newsItems) {
      const categories: string[] = (() => {
        try { return JSON.parse(news.categories_json || "[]"); } catch { return []; }
      })();
      const newsText = [news.title, news.summary || "", ...categories].join(" ");
      const newsWordSet = new Set(extractKeywords(newsText));

      // Score all markets, keep top N
      const scored: { marketId: string; score: number }[] = [];
      for (const market of marketKeywords) {
        if (market.keywords.length < 2) continue; // skip markets with too few keywords
        const hits = market.keywords.filter((kw) => newsWordSet.has(kw));
        const matchRate = hits.length / market.keywords.length;

        if (hits.length >= 3 && matchRate >= 0.25) {
          scored.push({
            marketId: market.id,
            score: Math.min(1, matchRate * 2),
          });
        }
      }

      // Keep only top matches per news item
      scored.sort((a, b) => b.score - a.score);
      for (const m of scored.slice(0, MAX_MATCHES_PER_ITEM)) {
        upsertMatch.run(news.id, m.marketId, Math.round(m.score * 100) / 100);
        matches++;
      }
    }
  });
  matchTx();

  return matches;
}

async function runAiMatching(db: ReturnType<typeof getDb>): Promise<number> {
  // Find news items with zero keyword matches (published in last 3 days)
  const unmatched = db.prepare(`
    SELECT id, title, summary FROM news_items
    WHERE published_at > datetime('now', '-3 days')
      AND ai_match_done = 0
      AND id NOT IN (SELECT DISTINCT news_id FROM news_market_matches)
    LIMIT 50
  `).all() as Array<{ id: string; title: string; summary: string | null }>;

  if (unmatched.length === 0) return 0;

  const markets = db.prepare(`
    SELECT id, title FROM events WHERE is_active = 1 AND is_closed = 0
    ORDER BY volume_24h DESC LIMIT 100
  `).all() as Array<{ id: string; title: string }>;

  if (markets.length === 0) return 0;

  const upsertMatch = db.prepare(`
    INSERT INTO news_market_matches (news_id, market_id, relevance_score, match_method)
    VALUES (?, ?, ?, 'ai')
    ON CONFLICT(news_id, market_id) DO UPDATE SET
      relevance_score = MAX(excluded.relevance_score, news_market_matches.relevance_score)
  `);
  const markDone = db.prepare(`UPDATE news_items SET ai_match_done = 1 WHERE id = ?`);

  let matches = 0;
  for (const news of unmatched) {
    try {
      const results = await matchNewsToMarkets(news.title, news.summary, markets);
      for (const r of results) {
        upsertMatch.run(news.id, r.marketId, Math.round(r.score * 100) / 100);
        matches++;
      }
    } catch { /* skip individual failures */ }
    markDone.run(news.id);
    // 200ms delay between AI calls
    await new Promise((r) => setTimeout(r, 200));
  }

  if (matches > 0) console.info(`[newsSync] AI matched ${matches} news-market pairs`);
  return matches;
}

interface NewsItemRow {
  id: string;
  title: string;
  url: string;
  source: string;
  source_url: string;
  summary: string | null;
  published_at: string;
  image_url: string | null;
  categories_json: string;
  relevance_score?: number;
}

export function readNewsFromDb(marketId?: string): NewsItem[] {
  const db = getDb();

  if (marketId) {
    const rows = db.prepare(`
      SELECT n.*, m.relevance_score
      FROM news_items n
      JOIN news_market_matches m ON m.news_id = n.id
      WHERE m.market_id = ?
      ORDER BY m.relevance_score DESC, n.published_at DESC
      LIMIT 20
    `).all(marketId) as NewsItemRow[];
    return rows.map(rowToNewsItem);
  }

  const rows = db.prepare(`
    SELECT * FROM news_items
    ORDER BY published_at DESC
    LIMIT 30
  `).all() as NewsItemRow[];
  return rows.map(rowToNewsItem);
}

function rowToNewsItem(row: NewsItemRow): NewsItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source,
    sourceUrl: row.source_url || "",
    summary: row.summary || null,
    publishedAt: row.published_at || new Date().toISOString(),
    imageUrl: row.image_url || null,
    categories: (() => {
      try { return JSON.parse(row.categories_json || "[]"); } catch { return []; }
    })(),
  };
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

export function startNewsSyncLoop() {
  if (syncTimer) return;
  // Run immediately then every 5 minutes
  runNewsSync().catch((err) => console.error("[newsSync] initial sync error:", err));
  syncTimer = setInterval(() => {
    runNewsSync().catch((err) => console.error("[newsSync] sync error:", err));
  }, NEWS_SYNC_INTERVAL);
}

export function stopNewsSyncLoop() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.info("[newsSync] Stopped news sync loop");
  }
}
