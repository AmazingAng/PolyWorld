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
  it("uses max of 5 ticks or 1% for buffer", () => {
    // 0.56 * 0.01 = 0.0056, 5 ticks = 0.05 → 5 ticks wins → 0.61
    expect(bufferMarketPrice("BUY", 0.56, 0.01)).toBe(0.61);
    // 0.46 - 0.05 = 0.41
    expect(bufferMarketPrice("SELL", 0.46, 0.01)).toBe(0.41);
  });

  it("clamps BUY result to 1 - tick maximum", () => {
    expect(bufferMarketPrice("BUY", 0.99, 0.01)).toBe(0.99);
    expect(bufferMarketPrice("BUY", 0.96, 0.01)).toBe(0.99);
  });

  it("clamps SELL result to tick minimum", () => {
    expect(bufferMarketPrice("SELL", 0.01, 0.01)).toBe(0.01);
    expect(bufferMarketPrice("SELL", 0.04, 0.01)).toBe(0.01);
  });

  it("uses default tick size of 0.01 when not provided", () => {
    // 0.50 + max(0.05, 0.005) = 0.55
    expect(bufferMarketPrice("BUY", 0.50)).toBe(0.55);
    // 0.50 - 0.05 = 0.45
    expect(bufferMarketPrice("SELL", 0.50)).toBe(0.45);
  });

  it("handles sub-cent tick sizes with correct precision", () => {
    // 0.951 + max(0.005, 0.00951) = 0.951 + 0.00951 ≈ 0.960 (rounded to 3dp)
    expect(bufferMarketPrice("BUY", 0.951, 0.001)).toBe(0.961);
    // 0.951 - 0.00951 ≈ 0.941
    expect(bufferMarketPrice("SELL", 0.951, 0.001)).toBe(0.941);
  });
});
