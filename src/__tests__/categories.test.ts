import { describe, expect, it } from "vitest";
import { detectCategory, detectSubEmoji } from "@/lib/categories";
import type { PolymarketEvent } from "@/types";

function makeEvent(overrides: Partial<PolymarketEvent> = {}): PolymarketEvent {
  return {
    id: "test",
    title: overrides.title ?? "",
    slug: "test",
    markets: [],
    ...overrides,
  };
}

// ─── detectCategory ───────────────────────────────────────────────────────────

describe("detectCategory — tag-based", () => {
  it("returns Tech when tech tag is present", () => {
    const event = makeEvent({ title: "some market", tags: [{ label: "Technology" }] });
    expect(detectCategory(event)).toBe("Tech");
  });

  it("returns Politics when politic tag comes before culture tag", () => {
    const event = makeEvent({ tags: [{ label: "Politics" }, { label: "Entertainment" }] });
    expect(detectCategory(event)).toBe("Politics");
  });

  it("returns Tech over Culture when tech tag present even if culture tag comes first", () => {
    // Tech has higher priority than Culture in TAG_RULES
    const event = makeEvent({ tags: [{ label: "Pop Culture" }, { label: "Tech" }] });
    expect(detectCategory(event)).toBe("Tech");
  });

  it("returns Crypto when bitcoin tag present", () => {
    const event = makeEvent({ tags: [{ label: "bitcoin" }] });
    expect(detectCategory(event)).toBe("Crypto");
  });

  it("returns Sports for sport tag", () => {
    const event = makeEvent({ tags: [{ label: "Sports" }] });
    expect(detectCategory(event)).toBe("Sports");
  });

  it("returns Finance for finance tag", () => {
    const event = makeEvent({ tags: [{ label: "Finance" }] });
    expect(detectCategory(event)).toBe("Finance");
  });

  it("returns Culture for entertainment tag", () => {
    const event = makeEvent({ tags: [{ label: "Entertainment" }] });
    expect(detectCategory(event)).toBe("Culture");
  });
});

describe("detectCategory — keyword-based (no tags)", () => {
  it("detects Politics from title keywords", () => {
    const event = makeEvent({ title: "Will Biden win the election?" });
    expect(detectCategory(event)).toBe("Politics");
  });

  it("detects Crypto from bitcoin keyword", () => {
    const event = makeEvent({ title: "Will Bitcoin reach $100k?" });
    expect(detectCategory(event)).toBe("Crypto");
  });

  it("detects Sports from NBA keyword", () => {
    const event = makeEvent({ title: "Who will win the NBA championship?" });
    expect(detectCategory(event)).toBe("Sports");
  });

  it("detects Finance from interest rate keyword", () => {
    const event = makeEvent({ title: "Will the Fed cut interest rate in March?" });
    expect(detectCategory(event)).toBe("Finance");
  });

  it("detects Tech from AI keyword", () => {
    const event = makeEvent({ title: "Will OpenAI release GPT-5?" });
    expect(detectCategory(event)).toBe("Tech");
  });

  it("falls back to Other when no keywords match", () => {
    const event = makeEvent({ title: "Highest temperature in NYC on March 21" });
    expect(detectCategory(event)).toBe("Other");
  });

  it("picks highest-scoring category when multiple keywords match", () => {
    // "election" and "vote" both hit Politics — should beat single Crypto keyword
    const event = makeEvent({ title: "Will the senate vote to block the election results?" });
    expect(detectCategory(event)).toBe("Politics");
  });
});

// ─── detectSubEmoji ───────────────────────────────────────────────────────────

describe("detectSubEmoji — Sports", () => {
  it("returns soccer ball for soccer market", () => {
    expect(detectSubEmoji("Sports", "Will Manchester City win the Premier League?")).toBe("⚽");
  });

  it("returns basketball for NBA market", () => {
    expect(detectSubEmoji("Sports", "Will the Lakers win the NBA Finals?")).toBe("🏀");
  });

  it("returns football for NFL market", () => {
    expect(detectSubEmoji("Sports", "Who wins the Super Bowl?")).toBe("🏈");
  });

  it("returns F1 for Grand Prix market", () => {
    expect(detectSubEmoji("Sports", "Who wins the Monaco Grand Prix?")).toBe("🏎️");
  });

  it("returns boxing glove for UFC market", () => {
    expect(detectSubEmoji("Sports", "Will Jon Jones win at UFC 300?")).toBe("🥊");
  });

  it("returns null for generic sports market", () => {
    expect(detectSubEmoji("Sports", "Who wins the championship?")).toBeNull();
  });
});

describe("detectSubEmoji — Politics", () => {
  it("returns ballot for election market", () => {
    expect(detectSubEmoji("Politics", "Will Trump win the 2028 election?")).toBe("🗳️");
  });

  it("returns sword for war/military market", () => {
    expect(detectSubEmoji("Politics", "Will Russia launch a missile attack?")).toBe("⚔️");
  });

  it("returns scroll for legislation market", () => {
    expect(detectSubEmoji("Politics", "Will Congress pass the new immigration bill?")).toBe("📜");
  });

  it("returns handshake for diplomacy/sanction market", () => {
    expect(detectSubEmoji("Politics", "Will the US impose new sanctions on China?")).toBe("🤝");
  });

  it("returns scales for impeachment/trial market", () => {
    expect(detectSubEmoji("Politics", "Will Trump be convicted in the criminal trial?")).toBe("⚖️");
  });
});

describe("detectSubEmoji — Other", () => {
  it("returns thermometer for temperature market", () => {
    expect(detectSubEmoji("Other", "Highest temperature in NYC on March 21 2026")).toBe("🌡️");
  });

  it("returns thermometer for degrees keyword", () => {
    expect(detectSubEmoji("Other", "Will it exceed 90 degrees in Phoenix?")).toBe("🌡️");
  });

  it("returns null for unmatched Other market", () => {
    expect(detectSubEmoji("Other", "Will the market close up today?")).toBeNull();
  });
});

describe("detectSubEmoji — non-matching categories", () => {
  it("returns null for Crypto (no sub-rules)", () => {
    expect(detectSubEmoji("Crypto", "Will Bitcoin reach 150k?")).toBeNull();
  });

  it("returns null for Finance (no sub-rules)", () => {
    expect(detectSubEmoji("Finance", "Will inflation drop below 2%?")).toBeNull();
  });
});
