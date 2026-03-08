import crypto from "crypto";
import RssParser from "rss-parser";
import { getDb } from "./db";
import { TWEET_SOURCES } from "./tweetSources";
import type { TweetItem } from "@/types";

const parser = new RssParser({
  timeout: 10_000,
  headers: { "User-Agent": "PolyWorld/1.0" },
});
const TWEETS_SYNC_INTERVAL = 180_000; // 3 minutes

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "as", "be", "was", "are",
  "been", "has", "had", "have", "will", "can", "may", "not", "this",
  "that", "its", "his", "her", "their", "our", "your", "all", "more",
  "new", "out", "up", "one", "two", "also", "into", "over", "after",
  "than", "about", "says", "said", "would", "could", "should", "who",
  "what", "when", "where", "how", "which", "just", "some", "other",
  "most", "them", "these", "then", "so", "no", "yes", "he", "she",
  "they", "we", "you", "me", "him", "us", "my", "do", "did", "does",
  "if", "each", "get", "got", "go", "been", "being", "make", "made",
  "very", "much", "many", "any", "own", "such", "like", "even", "still",
  "between", "through", "during", "before", "under", "against", "both",
  "market", "markets", "price", "prices", "win", "winner", "won",
  "will", "year", "day", "time", "first", "last", "next", "end",
  "top", "best", "back", "take", "come", "world", "hit", "set",
  "per", "report", "reports", "according", "people", "says",
  "could", "may", "might", "week", "month", "state", "states",
  "news", "update", "latest", "today", "yesterday", "number",
]);

const MIN_KEYWORD_LENGTH = 4;
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

  // Cleanup: remove items older than 3 days
  db.prepare(`DELETE FROM tweet_items WHERE published_at < datetime('now', '-3 days')`).run();
  db.prepare(`DELETE FROM tweet_market_matches WHERE tweet_id NOT IN (SELECT id FROM tweet_items)`).run();

  console.log(`[tweetsSync] OK - ${totalItems} items, ${totalMatches} matches`);
  return { items: totalItems, matches: totalMatches };
}

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(w));
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
    `).all(marketId) as Array<Record<string, unknown>>;
    return rows.map(rowToTweetItem);
  }

  const rows = db.prepare(`
    SELECT * FROM tweet_items
    ORDER BY published_at DESC
    LIMIT 30
  `).all() as Array<Record<string, unknown>>;
  return rows.map(rowToTweetItem);
}

function rowToTweetItem(row: Record<string, unknown>): TweetItem {
  return {
    id: row.id as string,
    handle: row.handle as string,
    authorName: (row.author_name as string) || (row.handle as string),
    text: row.text as string,
    url: row.url as string,
    publishedAt: (row.published_at as string) || new Date().toISOString(),
    relevanceScore: row.relevance_score as number | undefined,
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
