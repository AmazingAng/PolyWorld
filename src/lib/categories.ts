import { Category, PolymarketEvent } from "@/types";

export const CATEGORY_COLORS: Record<Category, string> = {
  Politics: "#79c0ff",
  Crypto: "#ffa657",
  Sports: "#7ee787",
  Geopolitics: "#ff7b72",
  Tech: "#79dfc1",
  Culture: "#f778ba",
  Finance: "#d2a8ff",
  Other: "#8b949e",
};

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Politics: [
    "election",
    "president",
    "senate",
    "congress",
    "governor",
    "vote",
    "poll",
    "democrat",
    "republican",
    "gop",
    "primary",
    "nominee",
    "cabinet",
    "impeach",
    "party",
    "political",
    "mayor",
    "speaker",
  ],
  Geopolitics: [
    "war",
    "invasion",
    "ceasefire",
    "sanctions",
    "nuclear",
    "nato",
    "treaty",
    "military",
    "troops",
    "conflict",
    "diplomacy",
    "territory",
    "missile",
    "drone",
    "attack",
    "siege",
    "annex",
  ],
  Crypto: [
    "bitcoin",
    "btc",
    "ethereum",
    "eth",
    "crypto",
    "blockchain",
    "token",
    "defi",
    "nft",
    "solana",
    "dogecoin",
    "altcoin",
    "stablecoin",
    "binance",
    "coinbase",
  ],
  Sports: [
    "nfl",
    "nba",
    "mlb",
    "nhl",
    "soccer",
    "football",
    "basketball",
    "baseball",
    "tennis",
    "golf",
    "f1",
    "formula",
    "olympics",
    "world cup",
    "super bowl",
    "championship",
    "premier league",
    "champions league",
    "ufc",
    "boxing",
    "playoff",
    "mvp",
  ],
  Finance: [
    "fed ",
    "federal reserve",
    "interest rate",
    "gdp",
    "inflation",
    "recession",
    "stock",
    "sp500",
    "s&p",
    "nasdaq",
    "dow jones",
    "treasury",
    "bond",
    "yield",
    "tariff",
    "trade war",
  ],
  Tech: [
    "ai ",
    "artificial intelligence",
    "openai",
    "gpt",
    "apple",
    "google",
    "meta",
    "microsoft",
    "tesla",
    "spacex",
    "robot",
    "quantum",
    "chip",
    "semiconductor",
  ],
  Culture: [
    "oscar",
    "grammy",
    "emmy",
    "movie",
    "film",
    "album",
    "celebrity",
    "tiktok",
    "youtube",
    "influencer",
  ],
};

export function detectCategory(event: PolymarketEvent): Category {
  const text =
    `${event.title || ""} ${event.description || ""}`.toLowerCase();

  if (event.tags) {
    for (const tag of event.tags) {
      const name = (tag.label || tag.name || "").toLowerCase();
      if (name.includes("politic")) return "Politics";
      if (name.includes("crypto") || name.includes("bitcoin")) return "Crypto";
      if (name.includes("sport")) return "Sports";
      if (name.includes("geopolitic")) return "Geopolitics";
      if (name.includes("tech")) return "Tech";
      if (name.includes("culture") || name.includes("entertainment"))
        return "Culture";
      if (name.includes("financ") || name.includes("econ")) return "Finance";
    }
  }

  let bestCat: Category = "Other";
  let bestScore = 0;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat as Category;
    }
  }
  return bestCat;
}
