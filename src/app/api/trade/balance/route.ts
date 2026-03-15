import { NextRequest, NextResponse } from "next/server";
import { getTradeSession } from "@/lib/tradeSession";

const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const RPC_URLS = [
  "https://rpc.ankr.com/polygon",
  "https://1rpc.io/matic",
];

async function getOnChainUsdcBalance(address: string): Promise<number> {
  // balanceOf(address) selector = 0x70a08231
  const data = "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0");
  for (const rpc of RPC_URLS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", method: "eth_call",
          params: [{ to: USDC_E, data }, "latest"],
          id: 1,
        }),
      });
      const json = await res.json();
      if (json.result) {
        return parseInt(json.result, 16) / 1e6;
      }
    } catch { /* try next */ }
  }
  throw new Error("all RPCs failed");
}

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
    const proxyAddress = session.proxyAddress;
    const balance = await getOnChainUsdcBalance(proxyAddress);
    return NextResponse.json({ balance });
  } catch (e) {
    console.error("[balance] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to fetch balance" },
      { status: 500 }
    );
  }
}
