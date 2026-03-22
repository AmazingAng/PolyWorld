import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy for Polymarket's geoblock endpoint.
 * Forwards the client's real IP so Polymarket can evaluate geo-restriction.
 * @see https://docs.polymarket.com/api-reference/geoblock
 */
export async function GET(req: NextRequest) {
  // Forward the user's real IP to Polymarket
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "";

  try {
    const res = await fetch("https://polymarket.com/api/geoblock", {
      headers: clientIp ? { "X-Forwarded-For": clientIp } : {},
      signal: AbortSignal.timeout(5_000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    // If we can't reach Polymarket, don't block the user
    return NextResponse.json({ blocked: false });
  }
}
