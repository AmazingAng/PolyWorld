import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedClient } from "@/lib/polymarketCLOB";
import { OrderType } from "@polymarket/clob-client";
import { getTradeSession } from "@/lib/tradeSession";

function getSessionOrError(sessionToken: unknown) {
  if (typeof sessionToken !== "string" || !sessionToken) {
    return { error: NextResponse.json({ error: "sessionToken required" }, { status: 400 }) };
  }
  const session = getTradeSession(sessionToken);
  if (!session) {
    return { error: NextResponse.json({ error: "invalid or expired trade session" }, { status: 401 }) };
  }
  return { session };
}

export async function POST(req: NextRequest) {
  try {
    const { signedOrder, sessionToken } = await req.json();

    if (!signedOrder) {
      return NextResponse.json({ error: "signedOrder required" }, { status: 400 });
    }

    const sessionResult = getSessionOrError(sessionToken);
    if (sessionResult.error) return sessionResult.error;

    const client = createAuthenticatedClient(
      sessionResult.session.creds,
      sessionResult.session.proxyAddress,
      sessionResult.session.address
    );
    // postOrder accepts a pre-built signed order struct directly
    const resp = await client.postOrder(signedOrder, OrderType.GTC);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = resp as any;
    console.log("[trade/orders POST] CLOB response:", JSON.stringify(r));
    return NextResponse.json({
      orderId: String(r.orderID ?? r.order?.orderID ?? r.order?.id ?? r.id ?? ""),
      status:  r.status ?? "submitted",
      raw:     r,
    });
  } catch (err) {
    console.error("[trade/orders POST]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "order failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { orderId, sessionToken } = await req.json();

    if (!orderId) {
      return NextResponse.json({ error: "orderId required" }, { status: 400 });
    }

    const sessionResult = getSessionOrError(sessionToken);
    if (sessionResult.error) return sessionResult.error;

    const client = createAuthenticatedClient(
      sessionResult.session.creds,
      sessionResult.session.proxyAddress,
      sessionResult.session.address
    );
    await client.cancelOrder({ orderID: orderId });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[trade/orders DELETE]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "cancel failed" }, { status: 500 });
  }
}
