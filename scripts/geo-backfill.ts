import { getDb } from "../src/lib/db";
import { aiGeocodeBatch, addJitter } from "../src/lib/aiGeo";

const CONCURRENCY = 10;
const BATCH_SIZE = 25;

(async () => {
  const db = getDb();
  const pending = (db.prepare("SELECT COUNT(*) as c FROM events WHERE ai_geo_done = 0").get() as { c: number }).c;
  console.log(`Pending: ${pending}, concurrency: ${CONCURRENCY}`);

  const updateStmt = db.prepare(`
    UPDATE events SET lat = @lat, lng = @lng, location = @location,
      geo_city = @city, geo_country = @country, ai_geo_done = 1
    WHERE id = @id
  `);
  const markDoneStmt = db.prepare(`UPDATE events SET ai_geo_done = 1 WHERE id = ?`);

  let totalProcessed = 0;

  for (;;) {
    const rows = db
      .prepare("SELECT id, title, description, location FROM events WHERE ai_geo_done = 0 LIMIT ?")
      .all(CONCURRENCY * BATCH_SIZE) as Array<{ id: string; title: string; description: string | null; location: string | null }>;

    if (rows.length === 0) break;

    // Split into batches of 25
    const batches: typeof rows[] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      batches.push(rows.slice(i, i + BATCH_SIZE));
    }

    // Run up to CONCURRENCY batches in parallel
    const promises = batches.map(async (batch) => {
      const inputs = batch.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        currentLocation: r.location,
      }));

      try {
        const results = await aiGeocodeBatch(inputs);
        const resultMap = new Map(results.map((r) => [r.id, r]));

        for (const market of batch) {
          try {
            const result = resultMap.get(market.id);
            if (result && result.lat !== null && result.lng !== null) {
              const [jLat, jLng] = addJitter(result.lat, result.lng, market.id);
              updateStmt.run({
                id: market.id, lat: jLat, lng: jLng,
                location: result.location || market.location,
                city: result.city, country: result.country,
              });
            } else {
              markDoneStmt.run(market.id);
            }
          } catch { /* skip */ }
        }
        return batch.length;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : err;
        console.error(`[batch] AI call failed: ${msg}`);
        for (const market of batch) {
          try { markDoneStmt.run(market.id); } catch { /* skip */ }
        }
        return batch.length;
      }
    });

    const results = await Promise.all(promises);
    totalProcessed += results.reduce((a, b) => a + b, 0);

    const left = (db.prepare("SELECT COUNT(*) as c FROM events WHERE ai_geo_done = 0").get() as { c: number }).c;
    console.log(`[${new Date().toISOString().slice(11, 19)}] +${results.reduce((a, b) => a + b, 0)} → total ${totalProcessed}, remaining ${left}`);
  }

  const stats = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN ai_geo_done=1 THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN ai_geo_done=0 THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN ai_geo_done=1 AND lat IS NOT NULL THEN 1 ELSE 0 END) as geocoded,
      SUM(CASE WHEN ai_geo_done=1 AND lat IS NULL THEN 1 ELSE 0 END) as non_geo
    FROM events
  `).get();
  console.log("Done!", JSON.stringify(stats, null, 2));
})();
