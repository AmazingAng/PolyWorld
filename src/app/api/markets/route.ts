import { NextRequest, NextResponse } from "next/server";
import { readMarketsFromDb } from "@/lib/sync";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/apiError";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";

let cachedBody: string | null = null;
let cachedEtag: string | null = null;
let cacheTs = 0;
const CACHE_TTL = 10_000; // 10s — matches Cache-Control max-age

export async function GET(request: NextRequest) {
  try {
    const now = Date.now();

    // Rebuild cached response body if stale
    if (!cachedBody || now - cacheTs > CACHE_TTL) {
      const { mapped, unmapped } = readMarketsFromDb();

      let lastSync: string | null = null;
      try {
        const db = getDb();
        const row = db
          .prepare(
            `SELECT finished_at FROM sync_log WHERE status = 'ok' ORDER BY id DESC LIMIT 1`
          )
          .get() as { finished_at: string } | undefined;
        if (row) lastSync = row.finished_at;
      } catch {
        // ignore
      }

      cachedBody = JSON.stringify({ mapped, unmapped, lastSync });
      cachedEtag = `"${createHash("md5").update(cachedBody).digest("hex").slice(0, 16)}"`;
      cacheTs = now;
    }

    // Return 304 if client already has this version
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch === cachedEtag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: cachedEtag! },
      });
    }

    return new NextResponse(cachedBody, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=10, stale-while-revalidate=30",
        ETag: cachedEtag!,
      },
    });
  } catch (err) {
    return apiError("markets", "Error reading from DB", 500, err);
  }
}
