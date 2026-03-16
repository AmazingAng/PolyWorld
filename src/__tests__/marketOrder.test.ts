import { describe, expect, it } from "vitest";
import { bufferMarketPrice, calculateMarketExecutionPrice } from "@/lib/marketOrder";

describe("calculateMarketExecutionPrice", () => {
  it("walks asks to price a buy market order", () => {
    const price = calculateMarketExecutionPrice(
      "BUY",
      5,
      [],
      [
        { price: "0.55", size: "2" },
        { price: "0.56", size: "10" },
      ],
    );

    expect(price).toBe(0.56);
  });

  it("walks bids to price a sell market order", () => {
    const price = calculateMarketExecutionPrice(
      "SELL",
      15,
      [
        { price: "0.47", size: "10" },
        { price: "0.46", size: "10" },
      ],
      [],
    );

    expect(price).toBe(0.46);
  });

  it("throws when the book cannot fully satisfy the order", () => {
    expect(() =>
      calculateMarketExecutionPrice(
        "BUY",
        100,
        [],
        [{ price: "0.55", size: "2" }],
      ),
    ).toThrow("insufficient liquidity");
  });
});

describe("bufferMarketPrice", () => {
  it("adds two ticks for buys and subtracts two ticks for sells", () => {
    expect(bufferMarketPrice("BUY", 0.56, 0.01)).toBe(0.58);
    expect(bufferMarketPrice("SELL", 0.46, 0.01)).toBe(0.44);
  });
});
