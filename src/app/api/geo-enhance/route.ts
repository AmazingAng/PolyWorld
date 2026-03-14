import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { processUnGeocodedMarkets } from "@/lib/aiGeo";
import { apiError } from "@/lib/apiError";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const db = getDb();
    const processed = await processUnGeocodedMarkets(db);

    const remaining = db
      .prepare(`SELECT COUNT(*) as c FROM events WHERE ai_geo_done = 0`)
      .get() as { c: number };

    return NextResponse.json({ processed, remaining: remaining.c });
  } catch (err) {
    return apiError("geo-enhance", "Failed to process geocoding", 500, err);
  }
}

export async function GET() {
  try {
    const db = getDb();

    const total = (db.prepare(`SELECT COUNT(*) as c FROM events`).get() as { c: number }).c;
    const done = (db.prepare(`SELECT COUNT(*) as c FROM events WHERE ai_geo_done = 1`).get() as { c: number }).c;
    const pending = (db.prepare(`SELECT COUNT(*) as c FROM events WHERE ai_geo_done = 0`).get() as { c: number }).c;
    const geocoded = (db.prepare(`SELECT COUNT(*) as c FROM events WHERE ai_geo_done = 1 AND lat IS NOT NULL`).get() as { c: number }).c;
    const nonGeographic = (db.prepare(`SELECT COUNT(*) as c FROM events WHERE ai_geo_done = 1 AND lat IS NULL`).get() as { c: number }).c;

    return NextResponse.json({ total, done, pending, geocoded, non_geographic: nonGeographic });
  } catch (err) {
    return apiError("geo-enhance", "Failed to read geocoding status", 500, err);
  }
}
