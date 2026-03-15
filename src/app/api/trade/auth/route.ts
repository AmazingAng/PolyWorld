import { NextRequest, NextResponse } from "next/server";
import { deriveL2Creds } from "@/lib/polymarketCLOB";
import { createTradeSession, deleteTradeSession } from "@/lib/tradeSession";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/i;
const MAX_AUTH_AGE_SECONDS = 5 * 60;

export async function POST(req: NextRequest) {
  try {
    const { address, proxyAddress, signature, timestamp, nonce } = await req.json();

    if (!address || !signature || !timestamp || !proxyAddress) {
      return NextResponse.json({ error: "address, proxyAddress, signature, and timestamp required" }, { status: 400 });
    }

    if (!ADDRESS_RE.test(address) || !ADDRESS_RE.test(proxyAddress)) {
      return NextResponse.json({ error: "invalid address" }, { status: 400 });
    }

    const parsedTimestamp = Number(timestamp);
    if (!Number.isFinite(parsedTimestamp)) {
      return NextResponse.json({ error: "invalid timestamp" }, { status: 400 });
    }
    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - parsedTimestamp);
    if (ageSeconds > MAX_AUTH_AGE_SECONDS) {
      return NextResponse.json({ error: "expired authorization request" }, { status: 400 });
    }

    const creds = await deriveL2Creds(address, proxyAddress, nonce ?? 0, signature, parsedTimestamp);
    const session = createTradeSession({
      address,
      proxyAddress,
      creds,
    });
    return NextResponse.json(session);
  } catch (err) {
    console.error("[trade/auth]", err);
    const message = err instanceof Error ? err.message : "auth failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { sessionToken } = await req.json();
    if (typeof sessionToken !== "string" || !sessionToken) {
      return NextResponse.json({ error: "sessionToken required" }, { status: 400 });
    }
    deleteTradeSession(sessionToken);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[trade/auth delete]", err);
    return NextResponse.json({ error: "logout failed" }, { status: 500 });
  }
}
