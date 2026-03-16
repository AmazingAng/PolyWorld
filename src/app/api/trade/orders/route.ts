import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedClient } from "@/lib/polymarketCLOB";
import { OrderType } from "@polymarket/clob-client";
import { getTradeSession } from "@/lib/tradeSession";

const ORDER_TIMEOUT_MS = 15_000;
const TRADE_SETTLE_TIMEOUT_MS = 4_000;
const TRADE_POLL_INTERVAL_MS = 500;

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveMarketOrderResult(
  client: ReturnType<typeof createAuthenticatedClient>,
  proxyAddress: string,
  tokenId: string,
  startedAtIso: string,
) {
  const deadline = Date.now() + TRADE_SETTLE_TIMEOUT_MS;
  const normalizedProxy = proxyAddress.toLowerCase();

  while (Date.now() < deadline) {
    let trades: Awaited<ReturnType<typeof client.getTrades>> = [];
    try {
      trades = await client.getTrades(
        {
          asset_id: tokenId,
          after: startedAtIso,
        },
        true,
      );
    } catch (err) {
      // CLOB client throws "response.data is not iterable" when the trades
      // endpoint returns null/empty data — treat as no trades yet and retry.
      console.warn("[resolveMarketOrderResult] getTrades error (retrying):", err instanceof Error ? err.message : err);
    }

    const latest = trades.find((trade) => {
      if (trade.owner?.toLowerCase() === normalizedProxy) return true;
      if (trade.maker_address?.toLowerCase() === normalizedProxy) return true;
      return Array.isArray(trade.maker_orders) && trade.maker_orders.some((makerOrder) =>
        makerOrder.owner?.toLowerCase() === normalizedProxy || makerOrder.maker_address?.toLowerCase() === normalizedProxy
      );
    });

    if (latest) {
      return {
        status: latest.status || "matched",
        orderId: latest.taker_order_id || "",
        takingAmount: latest.size || "",
        makingAmount: latest.price ? String(Number(latest.size || 0) * Number(latest.price)) : "",
        transactionsHashes: latest.transaction_hash ? [latest.transaction_hash] : [],
      };
    }

    await sleep(TRADE_POLL_INTERVAL_MS);
  }

  return null;
}

async function resolveOpenOrderResult(
  client: ReturnType<typeof createAuthenticatedClient>,
  proxyAddress: string,
  tokenId: string,
) {
  const normalizedProxy = proxyAddress.toLowerCase();

  try {
    const openOrders = await client.getOpenOrders({ asset_id: tokenId }, true);
    const latest = openOrders.find((order) =>
      order.owner?.toLowerCase() === normalizedProxy || order.maker_address?.toLowerCase() === normalizedProxy
    );

    if (!latest) return null;

    return {
      status: latest.status || "live",
      orderId: latest.id || "",
      takingAmount: latest.size_matched || "",
      makingAmount: latest.original_size || "",
      transactionsHashes: latest.associate_trades ?? [],
    };
  } catch (err) {
    console.warn("[resolveOpenOrderResult] getOpenOrders error:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { signedOrder, sessionToken, marketOrder, traceId } = await req.json();
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt - 5_000).toISOString();

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
    console.log("[trade/orders POST] request", {
      traceId,
      marketOrder,
      builderAuth: Boolean(client.builderConfig),
      signer: sessionResult.session.address,
      proxyAddress: sessionResult.session.proxyAddress,
      order: {
        tokenId: signedOrder.tokenId,
        side: signedOrder.side,
        maker: signedOrder.maker,
        signer: signedOrder.signer,
        makerAmount: signedOrder.makerAmount,
        takerAmount: signedOrder.takerAmount,
        signatureType: signedOrder.signatureType,
        salt: signedOrder.salt,
      },
    });
    // Market orders use FAK so they can take available liquidity immediately
    // instead of failing the whole order on tiny book movements.
    // Limit orders use GTC and can rest on the book.
    const orderType = marketOrder ? OrderType.FAK : OrderType.GTC;
    const resp = await Promise.race([
      client.postOrder(signedOrder, orderType),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("order timed out")), ORDER_TIMEOUT_MS);
      }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = resp as any;
    console.log("[trade/orders POST] response", {
      traceId,
      builderAuth: Boolean(client.builderConfig),
      orderType,
      elapsedMs: Date.now() - startedAt,
      success: r.success,
      error: r.error,
      status: r.status,
      errorMsg: r.errorMsg,
      orderID: r.orderID ?? r.order?.orderID ?? r.order?.id ?? r.id ?? "",
      raw: r,
    });
    // The SDK can return either:
    // - order responses: { success, orderID, status, ... }
    // - transport/API errors: { error, status }
    // Treat both as failures instead of mislabeling them as "submitted".
    if (typeof r?.error === "string" && r.error) {
      return NextResponse.json(
        { error: r.error, debug: { upstreamStatus: r.status ?? 500, traceId } },
        { status: typeof r.status === "number" ? r.status : 400 },
      );
    }
    // Surface CLOB-level failures. Only check success===false; errorMsg can be
    // non-empty on successful GTC orders (e.g. partial-fill warnings).
    if (r.success === false) {
      return NextResponse.json(
        { error: r.errorMsg || "order failed", debug: { upstreamStatus: r.status ?? 400, traceId } },
        { status: 400 },
      );
    }
    const orderId = String(r.orderID ?? r.order?.orderID ?? r.order?.id ?? r.id ?? "");
    const rawStatus = typeof r.status === "string" ? r.status : "";
    const transactions = Array.isArray(r.transactionsHashes) ? r.transactionsHashes : [];
    const resolved = marketOrder && !orderId && !rawStatus
      ? await resolveMarketOrderResult(
          client,
          sessionResult.session.proxyAddress,
          String(signedOrder.tokenId),
          startedAtIso,
        )
      : null;
    const resolvedOpenOrder = !resolved && !orderId
      ? await resolveOpenOrderResult(
          client,
          sessionResult.session.proxyAddress,
          String(signedOrder.tokenId),
        )
      : null;
    const finalOrderId = resolved?.orderId || resolvedOpenOrder?.orderId || orderId;
    // If a market order returns an empty success payload, prefer "submitted"
    // over a hard "unmatched" unless we have observed a concrete trade result.
    const finalStatus = resolved?.status || resolvedOpenOrder?.status || rawStatus || "submitted";
    const finalTakingAmount = resolved?.takingAmount || resolvedOpenOrder?.takingAmount || (r.takingAmount ?? "");
    const finalMakingAmount = resolved?.makingAmount || resolvedOpenOrder?.makingAmount || (r.makingAmount ?? "");
    return NextResponse.json({
      orderId: finalOrderId,
      status: finalStatus,
      debug: {
        success: r.success,
        errorMsg: r.errorMsg ?? "",
        rawStatus,
        orderId,
        takingAmount: finalTakingAmount,
        makingAmount: finalMakingAmount,
        transactionsHashes: resolved?.transactionsHashes || resolvedOpenOrder?.transactionsHashes || transactions,
        resolvedViaTrades: !!resolved,
        resolvedViaOpenOrders: !!resolvedOpenOrder,
      },
    });
  } catch (err) {
    console.error("[trade/orders POST] error", err);
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
