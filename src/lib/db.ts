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
    CREATE INDEX IF NOT EXISTS idx_market_snapshots_market_time ON market_snapshots(market_id, recorded_at);

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT,
      finished_at TEXT,
      event_count INTEGER,
      status TEXT,
      error_msg TEXT
    );
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
  ];

  for (const [col, type] of migrations) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE events ADD COLUMN ${col} ${type}`);
    }
  }
}
