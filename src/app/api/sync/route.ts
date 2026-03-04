import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await runSync();
  return NextResponse.json(result);
}
