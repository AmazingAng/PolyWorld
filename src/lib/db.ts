import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "polyworld.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DB_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  initSchema(db);
  migrate(db);

  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      market_id TEXT,
      title TEXT,
      slug TEXT,
      category TEXT,
      volume REAL,
      volume_24h REAL,
      prob REAL,
      change REAL,
      recent_change REAL,
      location TEXT,
      lat REAL,
      lng REAL,
      markets_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
    CREATE INDEX IF NOT EXISTS idx_events_volume_24h ON events(volume_24h DESC);
    CREATE INDEX IF NOT EXISTS idx_events_updated_at ON events(updated_at);
    CREATE INDEX IF NOT EXISTS idx_events_location ON events(location);

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT,
      prob REAL,
      volume_24h REAL,
      change REAL,
      recorded_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_event_time ON price_snapshots(event_id, recorded_at);

    CREATE TABLE IF NOT EXISTS market_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT,
      market_id TEXT,
      label TEXT,
      prob REAL,
      recorded_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_market_snapshots_event_time ON market_snapshots(event_id, recorded_at);

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT,
      finished_at TEXT,
      event_count INTEGER,
      status TEXT,
      error_msg TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_summaries (
      cache_key TEXT PRIMARY KEY,
      summary TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      source_url TEXT,
      summary TEXT,
      published_at TEXT,
      fetched_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      image_url TEXT,
      categories_json TEXT DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_news_published ON news_items(published_at DESC);

    CREATE TABLE IF NOT EXISTS news_market_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      relevance_score REAL DEFAULT 0,
      match_method TEXT DEFAULT 'keyword',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(news_id, market_id)
    );
    CREATE INDEX IF NOT EXISTS idx_news_matches_market ON news_market_matches(market_id);

    -- Smart Money: top PnL wallets from leaderboard
    CREATE TABLE IF NOT EXISTS smart_wallets (
      address TEXT PRIMARY KEY,
      username TEXT,
      pnl REAL,
      volume REAL,
      rank INTEGER,
      profile_image TEXT,
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    -- Leaderboard cache: top 50 per time period (TODAY, WEEKLY, MONTHLY, ALL)
    CREATE TABLE IF NOT EXISTS leaderboard_cache (
      time_period TEXT NOT NULL,
      rank INTEGER NOT NULL,
      address TEXT NOT NULL,
      username TEXT,
      pnl REAL,
      volume REAL,
      profile_image TEXT,
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (time_period, rank)
    );

    -- Smart Money: large trades on tracked markets
    CREATE TABLE IF NOT EXISTS whale_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      condition_id TEXT NOT NULL,
      event_id TEXT,
      side TEXT NOT NULL,
      size REAL NOT NULL,
      price REAL,
      usdc_size REAL,
      outcome TEXT,
      title TEXT,
      slug TEXT,
      timestamp TEXT NOT NULL,
      is_smart_wallet INTEGER DEFAULT 0,
      fetched_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_whale_trades_event ON whale_trades(event_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_whale_trades_wallet ON whale_trades(wallet);
    CREATE INDEX IF NOT EXISTS idx_whale_trades_time ON whale_trades(timestamp DESC);

    CREATE TABLE IF NOT EXISTS tweet_items (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      author_name TEXT,
      text TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      published_at TEXT,
      fetched_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tweets_published ON tweet_items(published_at DESC);

    CREATE TABLE IF NOT EXISTS tweet_market_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      relevance_score REAL DEFAULT 0,
      match_method TEXT DEFAULT 'keyword',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(tweet_id, market_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tweet_matches_market ON tweet_market_matches(market_id);
  `);
}

// Add new columns for P1/P2 data fields
function migrate(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>;
  const existing = new Set(cols.map((c) => c.name));

  const migrations: [string, string][] = [
    ["description", "TEXT"],
    ["resolution_source", "TEXT"],
    ["end_date", "TEXT"],
    ["image", "TEXT"],
    ["liquidity", "REAL DEFAULT 0"],
    ["is_active", "INTEGER DEFAULT 1"],
    ["is_closed", "INTEGER DEFAULT 0"],
    ["comment_count", "INTEGER DEFAULT 0"],
    ["tags_json", "TEXT DEFAULT '[]'"],
    ["ai_geo_done", "INTEGER DEFAULT 0"],
    ["geo_city", "TEXT"],
    ["geo_country", "TEXT"],
  ];

  for (const [col, type] of migrations) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE events ADD COLUMN ${col} ${type}`);
    }
  }

  // Ensure whale_trades dedup index exists (may need to clean duplicates first)
  const idxExists = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_whale_trades_dedup'`
  ).get();
  if (!idxExists) {
    // Remove duplicates before creating unique index
    db.exec(`
      DELETE FROM whale_trades WHERE id NOT IN (
        SELECT MIN(id) FROM whale_trades GROUP BY wallet, condition_id, timestamp
      )
    `);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_whale_trades_dedup ON whale_trades(wallet, condition_id, timestamp)`);
  }

  // Index for AI geocoding queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_ai_geo_done ON events(ai_geo_done)`);
}
