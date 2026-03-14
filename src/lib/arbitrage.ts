import type { ProcessedMarket } from "@/types";

export interface ArbitrageOpportunity {
  eventId: string;
  eventTitle: string;
  slug: string;
  category: string;
  outcomes: Array<{ name: string; price: number; marketId: string }>;
  sumProb: number;
  deviation: number;
  direction: "over" | "under";
  impliedEdge: number;
  liquidity: number;
  volume24h: number;
}

function parseOutcomePrices(raw: string[] | string | undefined): number[] {
  if (!raw) return [];
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.map((v: string | number) => parseFloat(String(v))).filter((n) => !isNaN(n));
  } catch {
    return [];
  }
}

export function detectArbitrage(
  markets: ProcessedMarket[],
  feeRate = 0.02
): ArbitrageOpportunity[] {
  const results: ArbitrageOpportunity[] = [];

  for (const market of markets) {
    if (!market.active || market.closed) continue;
    if (market.endDate && new Date(market.endDate).getTime() < Date.now()) continue;

    if (market.markets.length > 1) {
      // Only negRisk markets have mutually exclusive outcomes
      // (elections, championships, "who will win?").
      // Non-negRisk multi-markets are date thresholds, props, etc.
      // where multiple outcomes can resolve Yes simultaneously.
      if (!market.negRisk) continue;

      // Skip if any sub-markets are inactive (placeholder slots still exist).
      // Polymarket negRisk contracts pre-create slots for future candidates.
      // As long as inactive slots remain, the probability space is not fully
      // claimed by listed candidates — the active sum exceeding 1.0 is normal
      // market spread, not exploitable arbitrage.
      const hasInactiveSlots = market.markets.some((m) => m.active === false);
      if (hasInactiveSlots) continue;

      const outcomes: ArbitrageOpportunity["outcomes"] = [];
      let sumProb = 0;
      let minLiquidity = Infinity;

      for (const sub of market.markets) {
        if (sub.active === false) continue;
        const prices = parseOutcomePrices(sub.outcomePrices);
        const yesPrice = prices[0];
        if (yesPrice === undefined || isNaN(yesPrice)) continue;
        sumProb += yesPrice;
        outcomes.push({
          name: sub.groupItemTitle || sub.question || "Unknown",
          price: yesPrice,
          marketId: sub.id,
        });
        const liq = sub.liquidity ?? 0;
        if (liq < minLiquidity) minLiquidity = liq;
      }

      if (outcomes.length < 2) continue;
      if (minLiquidity === Infinity) minLiquidity = market.liquidity;

      // Skip "many small options" markets (awards, player props with 10+ candidates).
      // Real arbitrage requires outcomes to collectively exhaust the probability space.
      // If avg price per outcome < 0.08 or more than 10 active outcomes, the market
      // simply has unlisted outcomes — the sum-to-1 assumption doesn't hold.
      const avgPrice = sumProb / outcomes.length;
      if (outcomes.length > 10 || avgPrice < 0.08) continue;

      // Skip threshold-based markets (economic indicators, stat lines).
      // Outcomes like "Above 3%", ">5%", "<2%" are not mutually exclusive in
      // the sum-to-1 sense — multiple can resolve YES simultaneously.
      const THRESHOLD_RE = /\b(above|below|over|under|more than|less than|at least|at most|higher than|lower than)\b|[<>≤≥]\s*\d/i;
      if (outcomes.some((o) => THRESHOLD_RE.test(o.name))) continue;

      // Skip numeric-range bracket markets (e.g. "3% – 4%", "2-3%").
      // These are economic indicator buckets — NOT mutually exclusive in the
      // sense that the sum-to-1 arbitrage logic requires.
      const RANGE_RE = /\d+(\.\d+)?%\s*[-–—]\s*\d+(\.\d+)?%|\d+\s*[-–—]\s*\d+(\.\d+)?%/;
      const rangeCount = outcomes.filter((o) => RANGE_RE.test(o.name)).length;
      if (rangeCount >= 2) continue;

      // Skip if probability space is poorly covered (< 70% of outcomes listed).
      // Signals a market with unlisted outcomes, not true arbitrage.
      if (sumProb < 0.70) continue;

      const deviation = Math.abs(sumProb - 1.0);
      // Each leg of multi-outcome arbitrage costs a separate fee.
      // Scale total fee by number of outcomes to avoid false positives
      // on markets where the gross edge doesn't cover all trade costs.
      const impliedEdge = deviation - feeRate * outcomes.length;
      if (impliedEdge <= 0) continue;
      if (minLiquidity < 1000) continue;

      results.push({
        eventId: market.id,
        eventTitle: market.title,
        slug: market.slug,
        category: market.category,
        outcomes,
        sumProb,
        deviation,
        direction: sumProb > 1.0 ? "over" : "under",
        impliedEdge,
        liquidity: minLiquidity,
        volume24h: market.volume24h,
      });
    } else if (market.markets.length === 1) {
      // Binary market: check yes + no != 1.0
      const sub = market.markets[0];
      const prices = parseOutcomePrices(sub.outcomePrices);
      if (prices.length < 2) continue;

      const sumProb = prices[0] + prices[1];
      const deviation = Math.abs(sumProb - 1.0);
      const impliedEdge = deviation - feeRate;
      if (impliedEdge <= 0) continue;
      if (market.liquidity < 1000) continue;

      results.push({
        eventId: market.id,
        eventTitle: market.title,
        slug: market.slug,
        category: market.category,
        outcomes: [
          { name: "Yes", price: prices[0], marketId: sub.id },
          { name: "No", price: prices[1], marketId: sub.id },
        ],
        sumProb,
        deviation,
        direction: sumProb > 1.0 ? "over" : "under",
        impliedEdge,
        liquidity: market.liquidity,
        volume24h: market.volume24h,
      });
    }
  }

  results.sort((a, b) => b.impliedEdge - a.impliedEdge);
  return results.slice(0, 20);
}
