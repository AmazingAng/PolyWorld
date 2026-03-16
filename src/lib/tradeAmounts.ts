import type { MarketSide } from "@/lib/marketOrder";

const SIZE_DECIMALS = 2;
const AMOUNT_DECIMALS = 4;

function decimalPlaces(num: number): number {
  if (Number.isInteger(num)) return 0;
  const parts = num.toString().split(".");
  return parts.length > 1 ? parts[1].length : 0;
}

export function roundDown(n: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.floor(n * factor) / factor;
}

function roundUp(n: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.ceil(n * factor) / factor;
}

function normalizeAmountPrecision(value: number): number {
  if (decimalPlaces(value) > AMOUNT_DECIMALS) {
    let adjusted = roundUp(value, AMOUNT_DECIMALS + 4);
    if (decimalPlaces(adjusted) > AMOUNT_DECIMALS) {
      adjusted = roundDown(adjusted, AMOUNT_DECIMALS);
    }
    return adjusted;
  }
  return value;
}

export function getMarketOrderRawAmounts(side: MarketSide, amount: number, price: number) {
  const rawPrice = roundDown(price, 2);

  if (side === "BUY") {
    const rawMakerAmt = roundDown(amount, SIZE_DECIMALS);
    const rawTakerAmt = normalizeAmountPrecision(rawMakerAmt / rawPrice);
    return { rawMakerAmt, rawTakerAmt, rawPrice };
  }

  const rawMakerAmt = roundDown(amount, SIZE_DECIMALS);
  const rawTakerAmt = normalizeAmountPrecision(rawMakerAmt * rawPrice);
  return { rawMakerAmt, rawTakerAmt, rawPrice };
}
