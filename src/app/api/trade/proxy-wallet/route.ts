import { NextRequest, NextResponse } from "next/server";

async function tryPublicProfile(address: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://gamma-api.polymarket.com/public-profile?address=${address}`,
      { headers: { "Accept": "application/json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.proxyWallet as string) || null;
  } catch {
    return null;
  }
}

async function tryPolymarketDataApi(address: string): Promise<string | null> {
  for (const endpoint of ["positions", "activity"]) {
    try {
      const res = await fetch(
        `https://data-api.polymarket.com/${endpoint}?user=${address}&limit=1`,
        { headers: { "Accept": "application/json" } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const proxy = Array.isArray(data) && data[0]?.proxyWallet
        ? (data[0].proxyWallet as string)
        : null;
      if (proxy) return proxy;
    } catch { /* try next */ }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

  try {
    // 1. Gamma public-profile — official endpoint, returns proxyWallet directly
    let proxyWallet = await tryPublicProfile(address);

    // 2. Polymarket data-api (requires existing positions or activity)
    if (!proxyWallet) proxyWallet = await tryPolymarketDataApi(address);

    // Note: Gnosis Safe TX Service fallback removed — blindly picking safes[0] is unsafe
    // when a user controls multiple Safes. Only trust Polymarket's own APIs.

    return NextResponse.json({ proxyWallet });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "lookup failed" },
      { status: 500 }
    );
  }
}
