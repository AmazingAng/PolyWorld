export type MarketSide = "BUY" | "SELL";

export interface BookLevel {
  price: number | string;
  size: number | string;
}

function asNumber(value: number | string): number {
  return typeof value === "number" ? value : Number.parseFloat(value);
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
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

export function bufferMarketPrice(side: MarketSide, executionPrice: number, tickSize = 0.01): number {
  const tick = tickSize > 0 ? tickSize : 0.01;
  const buffer = tick * 2;
  const buffered = side === "BUY"
    ? executionPrice + buffer
    : executionPrice - buffer;
  return roundPrice(Math.min(0.99, Math.max(0.01, buffered)));
}
