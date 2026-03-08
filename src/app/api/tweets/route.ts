import { NextResponse } from "next/server";
import { readTweetsFromDb } from "@/lib/tweetsSync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get("marketId") || undefined;
    const items = readTweetsFromDb(marketId);
    return NextResponse.json(items);
  } catch (err) {
    console.error("[api/tweets] error:", err);
    return NextResponse.json([], { status: 500 });
  }
}
