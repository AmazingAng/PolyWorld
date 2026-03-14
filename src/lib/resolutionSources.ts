import { NEWS_SOURCES } from "./newsSources";

export type MonitorTarget =
  | { type: "known_feed"; feedUrl: string; orgName: string }
  | { type: "price_feed"; provider: "binance" | "yahoo" | "cme"; symbol: string; url: string }
  | { type: "sports_feed"; feedUrl: string; sport: string; domain: string; source: string }
  | { type: "unmonitorable" };

// ── Text-based org name matching (V1, kept as fallback) ──

const ORG_PATTERNS: Array<{ patterns: string[]; sourceName: string }> = [
  { patterns: ["associated press", " ap ", "ap news"], sourceName: "ABC News" },
  { patterns: ["reuters"], sourceName: "Bloomberg" },
  { patterns: ["bbc"], sourceName: "BBC World" },
  { patterns: ["bloomberg"], sourceName: "Bloomberg" },
  { patterns: ["cnbc"], sourceName: "CNBC" },
  { patterns: ["new york times", "nyt", "nytimes"], sourceName: "NYT World" },
  { patterns: ["guardian"], sourceName: "The Guardian" },
  { patterns: ["al jazeera", "aljazeera"], sourceName: "Al Jazeera" },
  { patterns: ["politico"], sourceName: "Politico" },
  { patterns: ["france 24", "france24"], sourceName: "France 24" },
  { patterns: ["coindesk"], sourceName: "CoinDesk" },
  { patterns: ["decrypt"], sourceName: "Decrypt" },
  { patterns: ["nhk"], sourceName: "NHK World" },
  { patterns: ["channel news asia", "cna"], sourceName: "CNA" },
  { patterns: ["abc news"], sourceName: "ABC News" },
  { patterns: ["dw news", "deutsche welle"], sourceName: "DW News" },
];

const sourceByName = new Map(NEWS_SOURCES.map((s) => [s.name, s]));

// ── Phase 1: Price feed domain handlers ──

function parseBinanceSymbol(url: string): string | null {
  // https://www.binance.com/en/trade/BTC_USDT → BTCUSDT
  const match = url.match(/\/trade\/([\w]+)_([\w]+)/i);
  return match ? `${match[1]}${match[2]}`.toUpperCase() : null;
}

function parseChainlinkPair(url: string): string | null {
  // https://data.chain.link/streams/btc-usd → BTCUSDT (normalized to Binance format)
  const match = url.match(/\/streams?\/([\w]+)-([\w]+)/i);
  if (!match) return null;
  const base = match[1].toUpperCase();
  // Chainlink uses USD, Binance uses USDT
  return `${base}USDT`;
}

function parseYahooSymbol(url: string): string | null {
  // https://finance.yahoo.com/quote/TSLA/ → TSLA
  // https://finance.yahoo.com/quote/%5EGSPC/ → ^GSPC (URL-encoded)
  const decoded = decodeURIComponent(url);
  const match = decoded.match(/\/quote\/([^\s/]+)/i);
  return match ? match[1].toUpperCase() : null;
}

function parseCmeSymbol(url: string): string | null {
  // https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.settlements.html → CL
  // https://www.cmegroup.com/markets/metals/precious/gold.settlements.html → GC
  const CME_MAP: Record<string, string> = {
    "light-sweet-crude": "CL=F",
    "gold": "GC=F",
    "silver": "SI=F",
    "natural-gas": "NG=F",
    "copper": "HG=F",
  };
  for (const [path, symbol] of Object.entries(CME_MAP)) {
    if (url.includes(path)) return symbol;
  }
  return null;
}

// ── Phase 2: Sports domain → ESPN/BBC Sport RSS feed mapping ──

const SPORTS_FEED_MAP: Record<string, { feedUrl: string; sport: string; source: string }> = {
  // US Sports (ESPN)
  "nba.com": { feedUrl: "https://www.espn.com/espn/rss/nba/news", sport: "nba", source: "ESPN" },
  "nhl.com": { feedUrl: "https://www.espn.com/espn/rss/nhl/news", sport: "nhl", source: "ESPN" },
  "mlb.com": { feedUrl: "https://www.espn.com/espn/rss/mlb/news", sport: "mlb", source: "ESPN" },
  "ncaa.com": { feedUrl: "https://www.espn.com/espn/rss/ncb/news", sport: "ncaa", source: "ESPN" },
  "mlssoccer.com": { feedUrl: "https://www.espn.com/espn/rss/soccer/news", sport: "mls", source: "ESPN" },
  // UFC / MMA (ESPN)
  "ufc.com": { feedUrl: "https://www.espn.com/espn/rss/mma/news", sport: "ufc", source: "ESPN" },
  // European Football (BBC Sport)
  "premierleague.com": { feedUrl: "https://feeds.bbci.co.uk/sport/football/rss.xml", sport: "football", source: "BBC Sport" },
  "laliga.com": { feedUrl: "https://feeds.bbci.co.uk/sport/football/rss.xml", sport: "football", source: "BBC Sport" },
  "bundesliga.com": { feedUrl: "https://feeds.bbci.co.uk/sport/football/rss.xml", sport: "football", source: "BBC Sport" },
  "uefa.com": { feedUrl: "https://feeds.bbci.co.uk/sport/football/rss.xml", sport: "football", source: "BBC Sport" },
  "legaseriea.it": { feedUrl: "https://feeds.bbci.co.uk/sport/football/rss.xml", sport: "football", source: "BBC Sport" },
  "efl.com": { feedUrl: "https://feeds.bbci.co.uk/sport/football/rss.xml", sport: "football", source: "BBC Sport" },
  "ligue1.com": { feedUrl: "https://feeds.bbci.co.uk/sport/football/rss.xml", sport: "football", source: "BBC Sport" },
  "eredivisie.nl": { feedUrl: "https://feeds.bbci.co.uk/sport/football/rss.xml", sport: "football", source: "BBC Sport" },
  "ligamx.net": { feedUrl: "https://feeds.bbci.co.uk/sport/football/rss.xml", sport: "football", source: "BBC Sport" },
  // Tennis (BBC Sport)
  "atptour.com": { feedUrl: "https://feeds.bbci.co.uk/sport/tennis/rss.xml", sport: "tennis", source: "BBC Sport" },
  "wtatennis.com": { feedUrl: "https://feeds.bbci.co.uk/sport/tennis/rss.xml", sport: "tennis", source: "BBC Sport" },
  // Cricket (BBC Sport)
  "espncricinfo.com": { feedUrl: "https://feeds.bbci.co.uk/sport/cricket/rss.xml", sport: "cricket", source: "BBC Sport" },
  // Formula 1 (BBC Sport)
  "formula1.com": { feedUrl: "https://feeds.bbci.co.uk/sport/formula1/rss.xml", sport: "f1", source: "BBC Sport" },
  // Esports (HLTV)
  "hltv.org": { feedUrl: "https://www.hltv.org/rss/news", sport: "csgo", source: "HLTV" },
  // Golf (BBC Sport)
  "pgatour.com": { feedUrl: "https://feeds.bbci.co.uk/sport/golf/rss.xml", sport: "golf", source: "BBC Sport" },
  // Rugby (BBC Sport)
  "sixnationsrugby.com": { feedUrl: "https://feeds.bbci.co.uk/sport/rugby-union/rss.xml", sport: "rugby", source: "BBC Sport" },
  // Seeking Alpha (Finance)
  "seekingalpha.com": { feedUrl: "https://seekingalpha.com/market_currents.xml", sport: "finance", source: "Seeking Alpha" },
};

// ── Main parser ──

export function parseResolutionSource(raw: string | null): MonitorTarget {
  if (!raw) return { type: "unmonitorable" };

  // Try URL-based parsing first
  try {
    const url = new URL(raw);
    const hostname = url.hostname.replace(/^www\./, "");

    // Phase 1: Price feeds
    if (hostname === "binance.com") {
      const symbol = parseBinanceSymbol(raw);
      if (symbol) return { type: "price_feed", provider: "binance", symbol, url: raw };
    }
    if (hostname === "data.chain.link") {
      const symbol = parseChainlinkPair(raw);
      if (symbol) return { type: "price_feed", provider: "binance", symbol, url: raw };
    }
    if (hostname === "finance.yahoo.com") {
      const symbol = parseYahooSymbol(raw);
      if (symbol) return { type: "price_feed", provider: "yahoo", symbol, url: raw };
    }
    if (hostname === "cmegroup.com") {
      const symbol = parseCmeSymbol(raw);
      if (symbol) return { type: "price_feed", provider: "cme", symbol, url: raw };
    }
    if (hostname === "nasdaq.com") {
      // https://www.nasdaq.com/market-activity/stocks/aapl
      const match = raw.match(/\/stocks\/([\w]+)/i);
      if (match) return { type: "price_feed", provider: "yahoo", symbol: match[1].toUpperCase(), url: raw };
    }

    // Phase 2: Sports feeds
    const sportEntry = SPORTS_FEED_MAP[hostname];
    if (sportEntry) {
      return { type: "sports_feed", feedUrl: sportEntry.feedUrl, sport: sportEntry.sport, domain: hostname, source: sportEntry.source };
    }
  } catch {
    // Not a valid URL — fall through to text matching
  }

  // V1 fallback: text-based org name matching
  const lower = ` ${raw.toLowerCase()} `;
  for (const { patterns, sourceName } of ORG_PATTERNS) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) {
        const source = sourceByName.get(sourceName);
        if (source) {
          return { type: "known_feed", feedUrl: source.feedUrl, orgName: sourceName };
        }
      }
    }
  }

  return { type: "unmonitorable" };
}
