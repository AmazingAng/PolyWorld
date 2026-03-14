import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync";
import { apiError } from "@/lib/apiError";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runSync();
    return NextResponse.json(result);
  } catch (err) {
    return apiError("sync", "Sync failed", 500, err);
  }
}
