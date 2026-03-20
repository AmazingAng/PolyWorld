import { NextResponse } from "next/server";
import { readMarketsFromDb } from "@/lib/sync";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/apiError";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { mapped, unmapped } = readMarketsFromDb();

    // Get last successful sync time
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

    return NextResponse.json(
      { mapped, unmapped, lastSync },
      { headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=30" } }
    );
  } catch (err) {
    return apiError("markets", "Error reading from DB", 500, err);
  }
}
