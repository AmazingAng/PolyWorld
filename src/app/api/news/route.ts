import { NextResponse } from "next/server";
import { readNewsFromDb } from "@/lib/newsSync";
import { apiError } from "@/lib/apiError";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get("marketId") || undefined;
    const items = readNewsFromDb(marketId);
    return NextResponse.json(items);
  } catch (err) {
    return apiError("news", "Failed to read news", 500, err);
  }
}
