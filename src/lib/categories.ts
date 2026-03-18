import { Category, PolymarketEvent } from "@/types";

export const CATEGORY_SHAPES: Record<Category, string> = {
  Politics:    "circle",
  Crypto:      "diamond",
  Sports:      "triangle",
  Finance:     "pentagon",
  Tech:        "square",
  Culture:     "hexagon",
  Other:       "circle",
};

export const CATEGORY_EMOJI: Record<Category, string> = {
  Politics: "🏛️",
  Crypto:   "₿",
  Sports:   "🏆",
  Finance:  "📈",
  Tech:     "💻",
  Culture:  "🎭",
  Other:    "🌐",
};

// Sub-category emoji overrides per category — matched against market title/description
const SUB_EMOJI_KEYWORDS: Partial<Record<Category, [string[], string][]>> = {
  Sports: [
    [["soccer", "football", "premier league", "champions league", "world cup", "la liga", "bundesliga", "serie a", "ligue 1", "mls ", "fifa"], "⚽"],
    [["basketball", "nba", "wnba", "ncaa basketball", "march madness"], "🏀"],
    [["baseball", "mlb", "world series"], "⚾"],
    [["hockey", "nhl", "stanley cup"], "🏒"],
    [["tennis", "wimbledon", "us open tennis", "french open", "australian open tennis", "atp", "wta"], "🎾"],
    [["golf", "pga", "masters", "ryder cup"], "⛳"],
    [["f1", "formula 1", "formula one", "grand prix"], "🏎️"],
    [["ufc", "boxing", "mma", "mixed martial arts", "fight night", "bellator"], "🥊"],
    [["nfl", "super bowl", "touchdown", "quarterback"], "🏈"],
    [["cricket", "ipl", "test match", "ashes"], "🏏"],
    [["olympics", "olympic"], "🥇"],
  ],
  Politics: [
    [["election", "vote", "voter", "ballot", "poll", "primary", "nominee", "caucus", "runoff", "reelect", "campaign"], "🗳️"],
    [["war", "invasion", "ceasefire", "military", "troops", "missile", "drone", "attack", "siege", "airstrike", "bombing", "conflict", "annex"], "⚔️"],
    [["bill", "legislation", "law", "regulation", "policy", "reform", "mandate", "executive order", "veto", "amendment"], "📜"],
    [["sanction", "diplomacy", "treaty", "nato", "summit", "ambassador", "embassy", "trade deal", "alliance", "negotiate"], "🤝"],
    [["impeach", "indict", "trial", "supreme court", "judge", "ruling", "verdict", "lawsuit", "prosecution", "conviction", "acquit"], "⚖️"],
  ],
  Other: [
    [["temperature", "highest temp", "degrees", "heat wave", "cold wave", "freeze", "warmest", "coldest", "hot day"], "🌡️"],
  ],
};

/** All unique sub-category emojis for sprite generation */
export const ALL_SUB_EMOJIS: string[] = [...new Set(
  Object.values(SUB_EMOJI_KEYWORDS).flat().map(([, emoji]) => emoji)
)];

/** Returns a sub-category emoji override if the market title matches, otherwise null */
export function detectSubEmoji(category: Category, title: string, description?: string | null): string | null {
  const rules = SUB_EMOJI_KEYWORDS[category];
  if (!rules) return null;
  const text = `${title} ${description || ""}`.toLowerCase();
  for (const [keywords, emoji] of rules) {
    for (const kw of keywords) {
      if (text.includes(kw)) return emoji;
    }
  }
  return null;
}

export const CATEGORY_COLORS: Record<Category, string> = {
  Politics: "#79c0ff",
  Crypto: "#ffa657",
  Sports: "#7ee787",
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

  // Scan ALL tags and pick the highest-priority match
  if (event.tags) {
    const TAG_RULES: [RegExp, Category][] = [
      [/politic|geopolitic/, "Politics"],
      [/crypto|bitcoin/, "Crypto"],
      [/sport/, "Sports"],
      [/tech/, "Tech"],
      [/financ|econ/, "Finance"],
      [/culture|entertainment/, "Culture"],
    ];
    let bestPriority = TAG_RULES.length;
    let bestCatFromTags: Category | null = null;
    for (const tag of event.tags) {
      const name = (tag.label || tag.name || "").toLowerCase();
      for (let i = 0; i < TAG_RULES.length; i++) {
        if (i >= bestPriority) break;
        if (TAG_RULES[i][0].test(name)) {
          bestPriority = i;
          bestCatFromTags = TAG_RULES[i][1];
          break;
        }
      }
    }
    if (bestCatFromTags) return bestCatFromTags;
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
