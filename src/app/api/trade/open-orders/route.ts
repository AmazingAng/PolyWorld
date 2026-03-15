import { NextRequest, NextResponse } from "next/server";
import { getOpenOrders } from "@/lib/polymarketCLOB";
import { getTradeSession } from "@/lib/tradeSession";

export async function POST(req: NextRequest) {
  try {
    const { sessionToken } = await req.json();
    if (typeof sessionToken !== "string" || !sessionToken) {
      return NextResponse.json({ error: "sessionToken required" }, { status: 400 });
    }

    const session = getTradeSession(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "invalid or expired trade session" }, { status: 401 });
    }

    const orders = await getOpenOrders(
      session.creds,
      session.proxyAddress,
      session.address
    );
    return NextResponse.json({ orders });
  } catch (err) {
    console.error("[trade/open-orders]", err);
    const message = err instanceof Error ? err.message : "query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
