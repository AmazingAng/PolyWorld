import { NextResponse } from "next/server";
import { readTweetsFromDb } from "@/lib/tweetsSync";
import { apiError } from "@/lib/apiError";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get("marketId") || undefined;
    const items = readTweetsFromDb(marketId);
    return NextResponse.json(items);
  } catch (err) {
    return apiError("tweets", "Failed to read tweets", 500, err);
  }
}
