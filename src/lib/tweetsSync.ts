import crypto from "crypto";
import RssParser from "rss-parser";
import { getDb } from "./db";
import { TWEET_SOURCES } from "./tweetSources";
import { isAiConfigured, matchNewsToMarkets } from "./ai";
import { extractKeywords } from "./keywords";
import type { TweetItem } from "@/types";

const parser = new RssParser({
  timeout: 10_000,
  headers: { "User-Agent": "PolyWorld/1.0" },
});
const TWEETS_SYNC_INTERVAL = 180_000; // 3 minutes

const MAX_MATCHES_PER_ITEM = 20;

function makeId(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export async function runTweetsSync(): Promise<{ items: number; matches: number }> {
  const db = getDb();
  let totalItems = 0;
  let totalMatches = 0;

  const results = await Promise.allSettled(
    TWEET_SOURCES.map(async (source) => {
      const feed = await parser.parseURL(source.feedUrl);
      return { source, feed };
    })
  );

  const upsertStmt = db.prepare(`
    INSERT INTO tweet_items (id, handle, author_name, text, url, published_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      text = excluded.text,
      published_at = excluded.published_at
  `);

  const insertTx = db.transaction(() => {
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { source, feed } = result.value;
      const items = (feed.items || []).slice(0, 20);

      for (const item of items) {
        if (!item.link) continue;
        // Convert nitter.net links to twitter.com/x.com links
        const tweetUrl = item.link
          .replace(/https?:\/\/nitter\.net\//, "https://x.com/")
          .replace(/#m$/, "");
        const id = makeId(tweetUrl);
        const text = item.contentSnippet
          ? item.contentSnippet.trim()
          : item.content
            ? stripHtml(item.content)
            : item.title?.trim() || "";
        if (!text) continue;
        const publishedAt = item.isoDate || item.pubDate
          ? new Date(item.isoDate || item.pubDate!).toISOString()
          : new Date().toISOString();
        // Nitter feed title is "DisplayName / @handle"
        const authorName = feed.title?.split(" / @")[0]?.trim() || source.label;

        upsertStmt.run(
          id,
          source.handle,
          authorName,
          text.slice(0, 1000),
          tweetUrl,
          publishedAt,
        );
        totalItems++;
      }
    }
  });
  insertTx();

  totalMatches = runKeywordMatching(db);

  // AI semantic matching for zero-match tweets
  if (isAiConfigured()) {
    try {
      totalMatches += await runAiTweetMatching(db);
    } catch (err) {
      console.error("[tweetsSync] AI matching error:", err);
    }
  }

  // Cleanup: remove items older than 3 days
  db.prepare(`DELETE FROM tweet_items WHERE published_at < datetime('now', '-3 days')`).run();
  db.prepare(`DELETE FROM tweet_market_matches WHERE tweet_id NOT IN (SELECT id FROM tweet_items)`).run();

  console.info(`[tweetsSync] OK - ${totalItems} items, ${totalMatches} matches`);
  return { items: totalItems, matches: totalMatches };
}

function runKeywordMatching(db: ReturnType<typeof getDb>): number {
  const markets = db.prepare(`
    SELECT id, title, tags_json, location FROM events WHERE is_active = 1 AND is_closed = 0
  `).all() as Array<{ id: string; title: string; tags_json: string; location: string | null }>;

  if (markets.length === 0) return 0;

  const marketKeywords: Array<{ id: string; keywords: string[] }> = markets.map((m) => {
    const tags: string[] = (() => {
      try { return JSON.parse(m.tags_json || "[]"); } catch { return []; }
    })();
    const raw = [m.title, ...tags, m.location || ""].join(" ");
    const keywords = [...new Set(extractKeywords(raw))];
    return { id: m.id, keywords };
  });

  // Only match tweets that haven't been matched yet (incremental)
  const tweetItems = db.prepare(`
    SELECT id, text, handle FROM tweet_items
    WHERE published_at > datetime('now', '-3 days')
      AND id NOT IN (SELECT DISTINCT tweet_id FROM tweet_market_matches)
  `).all() as Array<{ id: string; text: string; handle: string }>;

  if (tweetItems.length === 0) return 0;

  const upsertMatch = db.prepare(`
    INSERT INTO tweet_market_matches (tweet_id, market_id, relevance_score, match_method)
    VALUES (?, ?, ?, 'keyword')
    ON CONFLICT(tweet_id, market_id) DO UPDATE SET
      relevance_score = MAX(excluded.relevance_score, tweet_market_matches.relevance_score)
  `);

  let matches = 0;
  const matchTx = db.transaction(() => {
    for (const tweet of tweetItems) {
      const tweetWordSet = new Set(extractKeywords(tweet.text));

      const scored: { marketId: string; score: number }[] = [];
      for (const market of marketKeywords) {
        if (market.keywords.length < 2) continue;
        const hits = market.keywords.filter((kw) => tweetWordSet.has(kw));
        const matchRate = hits.length / market.keywords.length;

        if (hits.length >= 3 && matchRate >= 0.25) {
          scored.push({
            marketId: market.id,
            score: Math.min(1, matchRate * 2),
          });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      for (const m of scored.slice(0, MAX_MATCHES_PER_ITEM)) {
        upsertMatch.run(tweet.id, m.marketId, Math.round(m.score * 100) / 100);
        matches++;
      }
    }
  });
  matchTx();

  return matches;
}

async function runAiTweetMatching(db: ReturnType<typeof getDb>): Promise<number> {
  const unmatched = db.prepare(`
    SELECT id, text FROM tweet_items
    WHERE published_at > datetime('now', '-3 days')
      AND ai_match_done = 0
      AND id NOT IN (SELECT DISTINCT tweet_id FROM tweet_market_matches)
    LIMIT 50
  `).all() as Array<{ id: string; text: string }>;

  if (unmatched.length === 0) return 0;

  const markets = db.prepare(`
    SELECT id, title FROM events WHERE is_active = 1 AND is_closed = 0
    ORDER BY volume_24h DESC LIMIT 100
  `).all() as Array<{ id: string; title: string }>;

  if (markets.length === 0) return 0;

  const upsertMatch = db.prepare(`
    INSERT INTO tweet_market_matches (tweet_id, market_id, relevance_score, match_method)
    VALUES (?, ?, ?, 'ai')
    ON CONFLICT(tweet_id, market_id) DO UPDATE SET
      relevance_score = MAX(excluded.relevance_score, tweet_market_matches.relevance_score)
  `);
  const markDone = db.prepare(`UPDATE tweet_items SET ai_match_done = 1 WHERE id = ?`);

  let matches = 0;
  for (const tweet of unmatched) {
    try {
      const results = await matchNewsToMarkets(tweet.text.slice(0, 200), null, markets);
      for (const r of results) {
        upsertMatch.run(tweet.id, r.marketId, Math.round(r.score * 100) / 100);
        matches++;
      }
    } catch { /* skip individual failures */ }
    markDone.run(tweet.id);
    await new Promise((r) => setTimeout(r, 200));
  }

  if (matches > 0) console.info(`[tweetsSync] AI matched ${matches} tweet-market pairs`);
  return matches;
}

interface TweetItemRow {
  id: string;
  handle: string;
  author_name: string;
  text: string;
  url: string;
  published_at: string;
  relevance_score?: number;
}

export function readTweetsFromDb(marketId?: string): TweetItem[] {
  const db = getDb();

  if (marketId) {
    const rows = db.prepare(`
      SELECT t.*, m.relevance_score
      FROM tweet_items t
      JOIN tweet_market_matches m ON m.tweet_id = t.id
      WHERE m.market_id = ?
      ORDER BY m.relevance_score DESC, t.published_at DESC
      LIMIT 20
    `).all(marketId) as TweetItemRow[];
    return rows.map(rowToTweetItem);
  }

  const rows = db.prepare(`
    SELECT * FROM tweet_items
    ORDER BY published_at DESC
    LIMIT 30
  `).all() as TweetItemRow[];
  return rows.map(rowToTweetItem);
}

function rowToTweetItem(row: TweetItemRow): TweetItem {
  return {
    id: row.id,
    handle: row.handle,
    authorName: row.author_name || row.handle,
    text: row.text,
    url: row.url,
    publishedAt: row.published_at || new Date().toISOString(),
    relevanceScore: row.relevance_score,
  };
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

export function startTweetsSyncLoop() {
  if (syncTimer) return;
  runTweetsSync().catch((err) => console.error("[tweetsSync] initial sync error:", err));
  syncTimer = setInterval(() => {
    runTweetsSync().catch((err) => console.error("[tweetsSync] sync error:", err));
  }, TWEETS_SYNC_INTERVAL);
}

export function stopTweetsSyncLoop() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.info("[tweetsSync] Stopped tweets sync loop");
  }
}
