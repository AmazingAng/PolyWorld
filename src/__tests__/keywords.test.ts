import { describe, it, expect } from "vitest";
import { extractKeywords, STOP_WORDS } from "@/lib/keywords";

describe("extractKeywords", () => {
  it("extracts words of length >= 4", () => {
    const result = extractKeywords("Trump wins the election");
    expect(result).toContain("trump");
    expect(result).toContain("wins");
    expect(result).toContain("election");
    // "the" is a stop word, should be excluded
    expect(result).not.toContain("the");
  });

  it("filters out stop words", () => {
    const result = extractKeywords("the market will crash today");
    // "the", "market", "will", "today" are all stop words
    expect(result).toEqual(["crash"]);
  });

  it("removes non-alphanumeric characters", () => {
    const result = extractKeywords("Biden's policy: no-fly zone");
    expect(result).toContain("biden");
    expect(result).toContain("policy");
    expect(result).toContain("zone");
  });

  it("returns empty array for empty input", () => {
    expect(extractKeywords("")).toEqual([]);
  });

  it("is case insensitive", () => {
    const result = extractKeywords("UKRAINE Russia Ceasefire");
    expect(result).toContain("ukraine");
    expect(result).toContain("russia");
    expect(result).toContain("ceasefire");
  });

  it("skips short words (< 4 chars)", () => {
    const result = extractKeywords("war oil gas tax");
    expect(result).toEqual([]);
  });
});

describe("STOP_WORDS", () => {
  it("contains common English stop words", () => {
    expect(STOP_WORDS.has("the")).toBe(true);
    expect(STOP_WORDS.has("and")).toBe(true);
    expect(STOP_WORDS.has("market")).toBe(true);
  });

  it("contains domain-specific stop words", () => {
    expect(STOP_WORDS.has("price")).toBe(true);
    expect(STOP_WORDS.has("winner")).toBe(true);
    expect(STOP_WORDS.has("report")).toBe(true);
  });
});
