import type { WhaleTrade, ProcessedMarket } from "@/types";

export type SignalType =
  | "whale_accumulation"
  | "smart_divergence"
  | "cluster_activity"
  | "momentum_shift";

export interface SmartSignal {
  id: string;
  type: SignalType;
  strength: "strong" | "moderate" | "weak";
  market: { title: string; slug: string; prob: number | null };
  wallets: Array<{ address: string; username: string | null }>;
  direction: "bullish" | "bearish";
  summary: string;
  timestamp: number;
  details: {
    totalVolume?: number;
    tradeCount?: number;
    smartRatio?: number;
    priceAtSignal?: number;
  };
}

function rateStrength(tradeCount: number, totalVolume: number): SmartSignal["strength"] {
  if (tradeCount >= 5 || totalVolume >= 20000) return "strong";
  if (tradeCount >= 3 || totalVolume >= 5000) return "moderate";
  return "weak";
}

function makeId(type: string, slug: string, ts: number): string {
  return `${type}_${slug}_${ts}`;
}

function uniqueWallets(trades: WhaleTrade[]): Array<{ address: string; username: string | null }> {
  const seen = new Map<string, string | null>();
  for (const t of trades) {
    if (!seen.has(t.wallet)) {
      seen.set(t.wallet, t.username ?? null);
    }
  }
  return Array.from(seen.entries()).map(([address, username]) => ({ address, username }));
}

function findMarket(slug: string, markets: ProcessedMarket[]): ProcessedMarket | undefined {
  return markets.find((m) => m.slug === slug);
}

export function detectSignals(
  trades: WhaleTrade[],
  markets: ProcessedMarket[],
  hoursBack = 6
): SmartSignal[] {
  const signals: SmartSignal[] = [];
  const now = Date.now();
  const cutoff = now - hoursBack * 3600_000;
  const cutoff2h = now - 2 * 3600_000;
  const cutoff3h = now - 3 * 3600_000;

  // Filter smart trades within timeframe
  const recentTrades = trades.filter(
    (t) => t.isSmartWallet && new Date(t.timestamp).getTime() >= cutoff
  );

  if (recentTrades.length === 0) return [];

  // Group trades by slug
  const bySlug = new Map<string, WhaleTrade[]>();
  for (const t of recentTrades) {
    if (!bySlug.has(t.slug)) bySlug.set(t.slug, []);
    bySlug.get(t.slug)!.push(t);
  }

  for (const [slug, slugTrades] of bySlug) {
    const market = findMarket(slug, markets);
    if (!market) continue;

    const marketInfo = { title: market.title, slug: market.slug, prob: market.prob };

    // 1. Whale Accumulation: same wallet, same market, >=3 buys, total >= $5000
    const byWallet = new Map<string, WhaleTrade[]>();
    for (const t of slugTrades) {
      if (!byWallet.has(t.wallet)) byWallet.set(t.wallet, []);
      byWallet.get(t.wallet)!.push(t);
    }

    for (const [wallet, walletTrades] of byWallet) {
      const buys = walletTrades.filter((t) => t.side === "BUY");
      const sells = walletTrades.filter((t) => t.side === "SELL");

      const buyVol = buys.reduce((s, t) => s + t.usdcSize, 0);
      const sellVol = sells.reduce((s, t) => s + t.usdcSize, 0);

      if (buys.length >= 3 && buyVol >= 5000) {
        const strength = rateStrength(buys.length, buyVol);
        signals.push({
          id: makeId("whale_accumulation", slug, now),
          type: "whale_accumulation",
          strength,
          market: marketInfo,
          wallets: [{ address: wallet, username: walletTrades[0].username ?? null }],
          direction: "bullish",
          summary: `Whale accumulating ${market.title} — ${buys.length} buys totaling $${(buyVol / 1000).toFixed(1)}k`,
          timestamp: Math.max(...buys.map((t) => new Date(t.timestamp).getTime())),
          details: { totalVolume: buyVol, tradeCount: buys.length, priceAtSignal: market.prob ?? undefined },
        });
      } else if (sells.length >= 3 && sellVol >= 5000) {
        const strength = rateStrength(sells.length, sellVol);
        signals.push({
          id: makeId("whale_accumulation", slug, now),
          type: "whale_accumulation",
          strength,
          market: marketInfo,
          wallets: [{ address: wallet, username: walletTrades[0].username ?? null }],
          direction: "bearish",
          summary: `Whale distributing ${market.title} — ${sells.length} sells totaling $${(sellVol / 1000).toFixed(1)}k`,
          timestamp: Math.max(...sells.map((t) => new Date(t.timestamp).getTime())),
          details: { totalVolume: sellVol, tradeCount: sells.length, priceAtSignal: market.prob ?? undefined },
        });
      }
    }

    // 2. Smart Divergence: market price direction vs smart money net flow
    if (market.change !== null && market.smartMoney) {
      const netFlow = market.smartMoney.netFlow;
      const priceDown = market.change < -0.02;
      const priceUp = market.change > 0.02;

      if ((priceDown && netFlow === "bullish") || (priceUp && netFlow === "bearish")) {
        const direction = netFlow === "bullish" ? "bullish" : "bearish";
        const wallets = uniqueWallets(slugTrades);
        const totalVol = slugTrades.reduce((s, t) => s + t.usdcSize, 0);
        const strength = rateStrength(slugTrades.length, totalVol);

        signals.push({
          id: makeId("smart_divergence", slug, now),
          type: "smart_divergence",
          strength,
          market: marketInfo,
          wallets,
          direction,
          summary: `Smart money ${direction} on ${market.title} while price ${priceDown ? "dropping" : "rising"} ${(Math.abs(market.change) * 100).toFixed(1)}%`,
          timestamp: now,
          details: {
            totalVolume: totalVol,
            tradeCount: slugTrades.length,
            smartRatio: market.smartMoney.smartBuys / Math.max(market.smartMoney.smartBuys + market.smartMoney.smartSells, 1),
            priceAtSignal: market.prob ?? undefined,
          },
        });
      }
    }

    // 3. Cluster Activity: >=3 different wallets same direction within 2h
    const recent2h = slugTrades.filter((t) => new Date(t.timestamp).getTime() >= cutoff2h);
    const buyWallets2h = new Set(recent2h.filter((t) => t.side === "BUY").map((t) => t.wallet));
    const sellWallets2h = new Set(recent2h.filter((t) => t.side === "SELL").map((t) => t.wallet));

    if (buyWallets2h.size >= 2) {
      const clusterTrades = recent2h.filter((t) => t.side === "BUY");
      const totalVol = clusterTrades.reduce((s, t) => s + t.usdcSize, 0);
      const strength = rateStrength(clusterTrades.length, totalVol);
      signals.push({
        id: makeId("cluster_activity_buy", slug, now),
        type: "cluster_activity",
        strength,
        market: marketInfo,
        wallets: uniqueWallets(clusterTrades),
        direction: "bullish",
        summary: `${buyWallets2h.size} smart wallets buying ${market.title} in last 2h`,
        timestamp: Math.max(...clusterTrades.map((t) => new Date(t.timestamp).getTime())),
        details: { totalVolume: totalVol, tradeCount: clusterTrades.length, priceAtSignal: market.prob ?? undefined },
      });
    }

    if (sellWallets2h.size >= 2) {
      const clusterTrades = recent2h.filter((t) => t.side === "SELL");
      const totalVol = clusterTrades.reduce((s, t) => s + t.usdcSize, 0);
      const strength = rateStrength(clusterTrades.length, totalVol);
      signals.push({
        id: makeId("cluster_activity_sell", slug, now),
        type: "cluster_activity",
        strength,
        market: marketInfo,
        wallets: uniqueWallets(clusterTrades),
        direction: "bearish",
        summary: `${sellWallets2h.size} smart wallets selling ${market.title} in last 2h`,
        timestamp: Math.max(...clusterTrades.map((t) => new Date(t.timestamp).getTime())),
        details: { totalVolume: totalVol, tradeCount: clusterTrades.length, priceAtSignal: market.prob ?? undefined },
      });
    }

    // 4. Momentum Shift: recent 3h net direction vs previous 3h
    const recent3h = slugTrades.filter((t) => new Date(t.timestamp).getTime() >= cutoff3h);
    const older3h = slugTrades.filter((t) => {
      const ts = new Date(t.timestamp).getTime();
      return ts >= cutoff && ts < cutoff3h;
    });

    if (recent3h.length >= 2 && older3h.length >= 2) {
      const recentNet = recent3h.reduce((s, t) => s + (t.side === "BUY" ? t.usdcSize : -t.usdcSize), 0);
      const olderNet = older3h.reduce((s, t) => s + (t.side === "BUY" ? t.usdcSize : -t.usdcSize), 0);

      if ((recentNet > 0 && olderNet < 0) || (recentNet < 0 && olderNet > 0)) {
        const direction = recentNet > 0 ? "bullish" : "bearish";
        const allTrades = [...recent3h, ...older3h];
        const totalVol = allTrades.reduce((s, t) => s + t.usdcSize, 0);
        const strength = rateStrength(allTrades.length, totalVol);

        signals.push({
          id: makeId("momentum_shift", slug, now),
          type: "momentum_shift",
          strength,
          market: marketInfo,
          wallets: uniqueWallets(allTrades),
          direction,
          summary: `Smart money momentum shifted ${direction} on ${market.title}`,
          timestamp: now,
          details: { totalVolume: totalVol, tradeCount: allTrades.length, priceAtSignal: market.prob ?? undefined },
        });
      }
    }
  }

  // Deduplicate by keeping strongest signal per type+slug
  const deduped = new Map<string, SmartSignal>();
  const strengthRank = { strong: 3, moderate: 2, weak: 1 };
  for (const sig of signals) {
    const key = `${sig.type}_${sig.market.slug}`;
    const existing = deduped.get(key);
    if (!existing || strengthRank[sig.strength] > strengthRank[existing.strength]) {
      deduped.set(key, sig);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => b.timestamp - a.timestamp);
}
