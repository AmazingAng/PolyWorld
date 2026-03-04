import { NextResponse } from "next/server";

const API_BASE = "https://gamma-api.polymarket.com";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const offset = Math.max(0, Math.min(1000, parseInt(searchParams.get("offset") || "0", 10) || 0));
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "100", 10) || 100));

  try {
    const url = `${API_BASE}/events?active=true&closed=false&limit=${limit}&offset=${offset}&order=volume24hr&ascending=false`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 30 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch from Polymarket" },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
