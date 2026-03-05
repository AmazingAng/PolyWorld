import { NextResponse } from "next/server";
import { readNewsFromDb } from "@/lib/newsSync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get("marketId") || undefined;
    const items = readNewsFromDb(marketId);
    return NextResponse.json(items);
  } catch (err) {
    console.error("[api/news] error:", err);
    return NextResponse.json([], { status: 500 });
  }
}
