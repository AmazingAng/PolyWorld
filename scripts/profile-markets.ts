import { getDb } from "../src/lib/db";
import { computeImpactScores } from "../src/lib/impact";
import { detectAnomalies } from "../src/lib/anomaly";

const db = getDb();
let t = Date.now();

const rows = db.prepare("SELECT * FROM events WHERE is_closed = 0 ORDER BY volume_24h DESC").all() as Array<Record<string, unknown>>;
console.log("1. DB query:", Date.now() - t, "ms, rows:", rows.length);

t = Date.now();
for (const r of rows) {
  JSON.parse((r.markets_json as string) || "[]");
  JSON.parse((r.tags_json as string) || "[]");
}
console.log("2. JSON parse:", Date.now() - t, "ms");

t = Date.now();
const fakeMarkets = rows.map((r) => ({
  id: r.id as string, volume24h: r.volume_24h as number, volume: r.volume as number,
  change: r.change as number, prob: r.prob as number, recentChange: r.recent_change as number,
  impactScore: 0, impactLevel: "info" as const,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
computeImpactScores(fakeMarkets as any);
console.log("3. Impact scores:", Date.now() - t, "ms");

t = Date.now();
const top50 = fakeMarkets.slice(0, 50).map((m) => m.id);
detectAnomalies(db, top50);
console.log("4. Anomaly detection:", Date.now() - t, "ms");

t = Date.now();
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const trades = db.prepare(
  "SELECT wallet,condition_id,event_id,side,size,price,usdc_size,outcome,title,slug,timestamp,is_smart_wallet FROM whale_trades WHERE timestamp >= ? ORDER BY timestamp DESC"
).all(cutoff);
console.log("5. Whale trades:", Date.now() - t, "ms, rows:", trades.length);

t = Date.now();
const wallets = db.prepare("SELECT address, username FROM smart_wallets").all();
console.log("6. Smart wallets:", Date.now() - t, "ms, rows:", wallets.length);

t = Date.now();
const mapped = rows.filter((r) => r.lat != null);
const unmapped = rows.filter((r) => r.lat == null);
const json = JSON.stringify({ mapped, unmapped });
console.log("7a. JSON serialize (full):", Date.now() - t, "ms, size:", (json.length / 1024 / 1024).toFixed(1), "MB");
console.log("   mapped:", mapped.length, "unmapped:", unmapped.length);

// Measure trimmed version
t = Date.now();
const trimFields = ["id","question","groupItemTitle","outcomePrices","outcomes","oneDayPriceChange","active","volume","volume_24hr","liquidity"];
const trimmedRows = rows.map((r) => {
  const m = JSON.parse((r.markets_json as string) || "[]");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trimmed = m.map((s: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t: any = {};
    for (const k of trimFields) if (s[k] !== undefined) t[k] = s[k];
    return t;
  });
  return { ...r, markets_json: undefined, markets: trimmed };
});
const mapped2 = trimmedRows.filter((r) => (r as Record<string, unknown>).lat != null);
const unmapped2 = trimmedRows.filter((r) => (r as Record<string, unknown>).lat == null);
const json2 = JSON.stringify({ mapped: mapped2, unmapped: unmapped2 });
console.log("7b. JSON serialize (trimmed):", Date.now() - t, "ms, size:", (json2.length / 1024 / 1024).toFixed(1), "MB");
