export type MarketSide = "BUY" | "SELL";

export interface BookLevel {
  price: number | string;
  size: number | string;
}

function asNumber(value: number | string): number {
  return typeof value === "number" ? value : Number.parseFloat(value);
}

function roundPriceTo(value: number, tickSize: number): number {
  const decimals = tickSize <= 0.001 ? 3 : tickSize <= 0.01 ? 2 : 1;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateMarketExecutionPrice(
  side: MarketSide,
  amount: number,
  bids: BookLevel[],
  asks: BookLevel[],
): number {
  if (!(amount > 0)) {
    throw new Error("amount must be positive");
  }

  if (side === "BUY") {
    let matchedNotional = 0;
    for (const level of asks) {
      const price = asNumber(level.price);
      const size = asNumber(level.size);
      matchedNotional += price * size;
      if (matchedNotional >= amount) {
        return price;
      }
    }
    throw new Error("insufficient liquidity");
  }

  let matchedShares = 0;
  for (const level of bids) {
    const price = asNumber(level.price);
    const size = asNumber(level.size);
    matchedShares += size;
    if (matchedShares >= amount) {
      return price;
    }
  }
  throw new Error("insufficient liquidity");
}

/**
 * Add a slippage buffer to the execution price.
 * Uses the larger of 5 ticks or 1% of execution price to account for
 * orderbook movement between quote fetch and wallet signing.
 * BUY → price + buffer (willing to pay slightly more)
 * SELL → price − buffer (willing to receive slightly less)
 * Result is clamped to [tickSize, 1 - tickSize].
 */
export function bufferMarketPrice(side: MarketSide, executionPrice: number, tickSize = 0.01): number {
  const tick = tickSize > 0 ? tickSize : 0.01;
  const buffer = Math.max(tick * 5, executionPrice * 0.01);
  const buffered = side === "BUY"
    ? executionPrice + buffer
    : executionPrice - buffer;
  return roundPriceTo(Math.min(1 - tick, Math.max(tick, buffered)), tick);
}
