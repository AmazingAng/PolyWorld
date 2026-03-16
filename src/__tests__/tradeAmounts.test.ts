import { describe, expect, it } from "vitest";
import { getMarketOrderRawAmounts } from "@/lib/tradeAmounts";

describe("getMarketOrderRawAmounts", () => {
  it("matches Polymarket buy market-order rounding", () => {
    expect(getMarketOrderRawAmounts("BUY", 5, 0.45)).toEqual({
      rawMakerAmt: 5,
      rawTakerAmt: 11.1111,
      rawPrice: 0.45,
    });
  });

  it("matches Polymarket sell market-order rounding", () => {
    expect(getMarketOrderRawAmounts("SELL", 11.11, 0.45)).toEqual({
      rawMakerAmt: 11.11,
      rawTakerAmt: 4.9995,
      rawPrice: 0.45,
    });
  });
});
