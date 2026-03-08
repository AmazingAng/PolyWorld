import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateMarketSummary, generateCountrySummary } from "@/lib/ai";
import type { MarketContext, CountryContext } from "@/lib/ai";
import { apiError } from "@/lib/apiError";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, cacheKey } = body as {
      type: "market" | "country";
      cacheKey: string;
    };

    if (!cacheKey || !type) {
      return NextResponse.json({ error: "Missing type or cacheKey" }, { status: 400 });
    }

    const db = getDb();

    // Check cache
    const cached = db
      .prepare("SELECT summary, created_at FROM ai_summaries WHERE cache_key = ?")
      .get(cacheKey) as { summary: string; created_at: string } | undefined;

    if (cached) {
      const age = Date.now() - new Date(cached.created_at).getTime();
      if (age < CACHE_TTL_MS) {
        return NextResponse.json({ summary: cached.summary, cached: true });
      }
    }

    // Generate summary
    let summary: string;

    if (type === "market") {
      const ctx = body.context as MarketContext;
      if (!ctx?.title) {
        return NextResponse.json({ error: "Missing market context" }, { status: 400 });
      }
      summary = await generateMarketSummary(ctx);
    } else {
      const ctx = body.context as CountryContext;
      if (!ctx?.country) {
        return NextResponse.json({ error: "Missing country context" }, { status: 400 });
      }
      summary = await generateCountrySummary(ctx);
    }

    // Store in cache
    db.prepare(
      `INSERT INTO ai_summaries (cache_key, summary, created_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(cache_key) DO UPDATE SET
         summary = excluded.summary,
         created_at = excluded.created_at`
    ).run(cacheKey, summary);

    return NextResponse.json({ summary, cached: false });
  } catch (err) {
    return apiError("summarize", err instanceof Error ? err.message : "Unknown error", 500, err);
  }
}
