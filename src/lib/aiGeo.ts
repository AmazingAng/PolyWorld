import type Database from "better-sqlite3";
import { client, fallbackClient, isAiConfigured } from "./ai";
import { geolocate } from "./geo";

interface MarketInput {
  id: string;
  title: string;
  description: string | null;
  currentLocation: string | null;
}

interface GeoResult {
  id: string;
  lat: number | null;
  lng: number | null;
  location: string | null;
  city: string | null;
  country: string | null;
  confidence: number;
}

export async function aiGeocodeBatch(markets: MarketInput[]): Promise<GeoResult[]> {
  if (markets.length === 0) return [];

  const marketLines = markets
    .map((m, i) => {
      const desc = m.description ? m.description.slice(0, 200) : "";
      return `${i + 1}. [${m.id}] ${m.title}${desc ? ` — ${desc}` : ""}`;
    })
    .join("\n");

  const prompt = `You are a geocoding expert. For each prediction market below, determine the most specific geographic location it relates to.

Markets:
${marketLines}

For each market, return the most specific location possible:
- City-level is best (e.g., "Washington, D.C." → 38.9072, -77.0369)
- Region/state if no city (e.g., "California" → 36.7783, -119.4179)
- Country centroid as fallback
- null for markets with no geographic relevance (e.g., crypto prices, abstract questions)

Return ONLY a JSON array with objects: {"id": "...", "lat": number|null, "lng": number|null, "location": "City, Country"|null, "city": "city"|null, "country": "country"|null, "confidence": 0.0-1.0}

Return ONLY valid JSON, no other text.`;

  let response;
  try {
    response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });
  } catch {
    response = await fallbackClient.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });
  }

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return markets.map((m) => ({ id: m.id, lat: null, lng: null, location: null, city: null, country: null, confidence: 0 }));

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((item: Record<string, unknown>) => typeof item.id === "string")
    .map((item: Record<string, unknown>) => ({
      id: item.id as string,
      lat: typeof item.lat === "number" && isFinite(item.lat as number) ? item.lat as number : null,
      lng: typeof item.lng === "number" && isFinite(item.lng as number) ? item.lng as number : null,
      location: typeof item.location === "string" ? item.location : null,
      city: typeof item.city === "string" ? item.city : null,
      country: typeof item.country === "string" ? item.country : null,
      confidence: typeof item.confidence === "number" ? Math.min(1, Math.max(0, item.confidence as number)) : 0,
    }));
}

/** Deterministic jitter based on market ID hash — ±0.02° (~2.2km) */
export function addJitter(lat: number, lng: number, id: string): [number, number] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  // Use different bits for lat and lng offsets
  const latOffset = ((hash & 0xffff) / 0xffff - 0.5) * 0.04; // ±0.02°
  const lngOffset = (((hash >>> 16) & 0xffff) / 0xffff - 0.5) * 0.04;
  return [lat + latOffset, lng + lngOffset];
}

/** Apply regex geolocate() fallback for a single market */
function regexFallback(market: { id: string; title: string; description: string | null }): GeoResult {
  const geo = geolocate(market.title, market.description ?? undefined);
  if (geo) {
    const [lat, lng] = addJitter(geo.coords[0], geo.coords[1], market.id);
    return { id: market.id, lat, lng, location: geo.location, city: null, country: null, confidence: 0.3 };
  }
  return { id: market.id, lat: null, lng: null, location: null, city: null, country: null, confidence: 0 };
}

/** Write a single geo result to the DB */
function writeGeoResult(
  updateStmt: ReturnType<Database.Database["prepare"]>,
  markDoneStmt: ReturnType<Database.Database["prepare"]>,
  market: { id: string; location: string | null },
  result: GeoResult | undefined,
) {
  if (result && result.lat !== null && result.lng !== null) {
    updateStmt.run({
      id: market.id,
      lat: result.lat,
      lng: result.lng,
      location: result.location || market.location,
      city: result.city,
      country: result.country,
    });
  } else {
    markDoneStmt.run(market.id);
  }
}

export async function processUnGeocodedMarkets(db: Database.Database): Promise<number> {
  let totalProcessed = 0;
  const aiEnabled = isAiConfigured();

  for (;;) {
    const rows = db
      .prepare(
        `SELECT id, title, description, location FROM events WHERE ai_geo_done = 0 LIMIT 500`
      )
      .all() as Array<{ id: string; title: string; description: string | null; location: string | null }>;

    if (rows.length === 0) break;

    const updateStmt = db.prepare(`
      UPDATE events SET
        lat = @lat, lng = @lng, location = @location,
        geo_city = @city, geo_country = @country,
        ai_geo_done = 1
      WHERE id = @id
    `);
    const markDoneStmt = db.prepare(`UPDATE events SET ai_geo_done = 1 WHERE id = ?`);

    // No AI configured — use regex for all
    if (!aiEnabled) {
      try {
        const txn = db.transaction(() => {
          for (const market of rows) {
            const result = regexFallback(market);
            writeGeoResult(updateStmt, markDoneStmt, market, result);
          }
        });
        txn();
      } catch {
        for (const market of rows) {
          try { writeGeoResult(updateStmt, markDoneStmt, market, regexFallback(market)); } catch { /* skip */ }
        }
      }
      totalProcessed += rows.length;
      console.log(`[aiGeo] Regex fallback: ${rows.length} processed`);
      continue;
    }

    // AI enabled — batch process with regex fallback for failures
    const BATCH_SIZE = 25;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const inputs: MarketInput[] = batch.map((r) => ({
        id: r.id, title: r.title, description: r.description, currentLocation: r.location,
      }));

      let results: GeoResult[] = [];
      let aiFailed = false;
      try {
        results = await aiGeocodeBatch(inputs);
      } catch (err) {
        console.error(`[aiGeo] AI call failed, using regex fallback:`, err instanceof Error ? err.message : err);
        aiFailed = true;
      }

      const resultMap = aiFailed ? null : new Map(results.map((r) => [r.id, r]));

      try {
        const txn = db.transaction(() => {
          for (const market of batch) {
            let result = resultMap?.get(market.id);
            // AI returned no geo → try regex fallback
            if (!result || (result.lat === null && result.lng === null)) {
              const fallback = regexFallback(market);
              if (fallback.lat !== null) result = fallback;
            }
            writeGeoResult(updateStmt, markDoneStmt, market, result);
          }
        });
        txn();
      } catch {
        for (const market of batch) {
          try {
            let result = resultMap?.get(market.id);
            if (!result || (result.lat === null && result.lng === null)) {
              const fallback = regexFallback(market);
              if (fallback.lat !== null) result = fallback;
            }
            writeGeoResult(updateStmt, markDoneStmt, market, result);
          } catch { /* skip */ }
        }
      }
      totalProcessed += batch.length;
      console.log(`[aiGeo] Progress: ${totalProcessed} processed`);
    }
  }

  console.log(`[aiGeo] Done — ${totalProcessed} markets total`);
  return totalProcessed;
}
