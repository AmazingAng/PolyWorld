import type { ProcessedMarket } from "@/types";

export interface OpenOrder {
  id: string;
  asset_id: string;
  side: "BUY" | "SELL";
  price: string;
  original_size: string;
  size_matched: string;
  status: string;
  order_type: string;
  expiration?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface ResolvedOrderMarket {
  title: string;
  outcome: string;
  slug: string;
  image?: string;
}

export async function fetchOpenOrders(sessionToken: string): Promise<OpenOrder[]> {
  const res = await fetch("/api/trade/open-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.orders) ? data.orders : [];
}

export async function cancelOpenOrder(orderId: string, sessionToken: string): Promise<void> {
  const res = await fetch("/api/trade/orders", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, sessionToken }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "cancel failed");
  }
}

export async function cancelAllOpenOrders(orderIds: string[], sessionToken: string): Promise<void> {
  await Promise.allSettled(orderIds.map((id) => cancelOpenOrder(id, sessionToken)));
}

/** Build a lookup map: tokenId → market info (call once, reuse for all orders) */
export function buildTokenIndex(
  markets: ProcessedMarket[],
): Map<string, ResolvedOrderMarket> {
  const index = new Map<string, ResolvedOrderMarket>();
  for (const ev of markets) {
    for (const m of ev.markets) {
      const raw = m.clobTokenIds;
      if (!raw) continue;
      try {
        const parsed: unknown[] = Array.isArray(raw) ? raw : JSON.parse(raw as unknown as string);
        const ids = parsed.map(String);
        const optionLabel = m.groupItemTitle || m.question || "";
        for (let i = 0; i < ids.length; i++) {
          if (!ids[i]) continue;
          // For binary markets (Yes/No), outcome is simply Yes/No
          // For multi-outcome markets, groupItemTitle is the option name (e.g. "No change")
          const defaultOutcome = i === 0 ? "Yes" : "No";
          const outcome = optionLabel && optionLabel !== ev.title
            ? (i === 0 ? optionLabel : `${optionLabel} No`)
            : defaultOutcome;
          index.set(ids[i], {
            title: ev.title,
            outcome,
            slug: ev.slug,
            image: ev.image ?? undefined,
          });
        }
      } catch {
        continue;
      }
    }
  }
  return index;
}

export function resolveOrderMarket(
  order: OpenOrder,
  markets: ProcessedMarket[],
): ResolvedOrderMarket | null {
  const assetId = String(order.asset_id ?? "");
  if (!assetId) return null;

  const index = buildTokenIndex(markets);
  return index.get(assetId) ?? null;
}
