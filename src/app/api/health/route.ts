import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const db = getDb();

    // Check DB readable
    const row = db.prepare(`SELECT 1 as ok`).get() as { ok: number } | undefined;
    if (!row || row.ok !== 1) {
      return NextResponse.json({ status: "error", reason: "db unreadable" }, { status: 503 });
    }

    // Check last sync was within 5 minutes
    const sync = db.prepare(
      `SELECT finished_at FROM sync_log WHERE status = 'ok' ORDER BY id DESC LIMIT 1`
    ).get() as { finished_at: string } | undefined;

    if (sync) {
      const lastSync = new Date(sync.finished_at).getTime();
      const age = Date.now() - lastSync;
      if (age > 5 * 60 * 1000) {
        return NextResponse.json(
          { status: "degraded", reason: "last sync too old", lastSyncAge: Math.round(age / 1000) },
          { status: 503 }
        );
      }
    }

    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { status: "error", reason: err instanceof Error ? err.message : "unknown" },
      { status: 503 }
    );
  }
}
