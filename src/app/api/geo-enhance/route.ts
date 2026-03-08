import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { processUnGeocodedMarkets } from "@/lib/aiGeo";

export const dynamic = "force-dynamic";

export async function POST() {
  const db = getDb();
  const processed = await processUnGeocodedMarkets(db);

  const remaining = db
    .prepare(`SELECT COUNT(*) as c FROM events WHERE ai_geo_done = 0`)
    .get() as { c: number };

  return NextResponse.json({ processed, remaining: remaining.c });
}

export async function GET() {
  const db = getDb();

  const total = (db.prepare(`SELECT COUNT(*) as c FROM events`).get() as { c: number }).c;
  const done = (db.prepare(`SELECT COUNT(*) as c FROM events WHERE ai_geo_done = 1`).get() as { c: number }).c;
  const pending = (db.prepare(`SELECT COUNT(*) as c FROM events WHERE ai_geo_done = 0`).get() as { c: number }).c;
  const geocoded = (db.prepare(`SELECT COUNT(*) as c FROM events WHERE ai_geo_done = 1 AND lat IS NOT NULL`).get() as { c: number }).c;
  const nonGeographic = (db.prepare(`SELECT COUNT(*) as c FROM events WHERE ai_geo_done = 1 AND lat IS NULL`).get() as { c: number }).c;

  return NextResponse.json({ total, done, pending, geocoded, non_geographic: nonGeographic });
}
