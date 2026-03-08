export interface TweetSource {
  handle: string;
  feedUrl: string;
  label: string;
}

// nitter.net provides free RSS feeds for Twitter/X accounts
const NITTER_BASE = "https://nitter.net";

export const TWEET_SOURCES: TweetSource[] = [
  {
    handle: "Polymarket",
    feedUrl: `${NITTER_BASE}/Polymarket/rss`,
    label: "Polymarket",
  },
  {
    handle: "PolymarketHelp",
    feedUrl: `${NITTER_BASE}/PolymarketHelp/rss`,
    label: "PM Help",
  },
  {
    handle: "Kalshi",
    feedUrl: `${NITTER_BASE}/Kalshi/rss`,
    label: "Kalshi",
  },
  {
    handle: "metacikilic",
    feedUrl: `${NITTER_BASE}/metacikilic/rss`,
    label: "Shayne",
  },
  {
    handle: "NateSilver538",
    feedUrl: `${NITTER_BASE}/NateSilver538/rss`,
    label: "Nate Silver",
  },
  {
    handle: "unusual_whales",
    feedUrl: `${NITTER_BASE}/unusual_whales/rss`,
    label: "UW",
  },
  {
    handle: "DeribitExchange",
    feedUrl: `${NITTER_BASE}/DeribitExchange/rss`,
    label: "Deribit",
  },
  {
    handle: "Sabortoothkitty",
    feedUrl: `${NITTER_BASE}/Sabortoothkitty/rss`,
    label: "STK",
  },
  {
    handle: "tier10k",
    feedUrl: `${NITTER_BASE}/tier10k/rss`,
    label: "Tier10K",
  },
];

export const HANDLE_ABBREVS: Record<string, string> = {
  Polymarket: "PM",
  PolymarketHelp: "PMH",
  Kalshi: "KL",
  metacikilic: "SC",
  NateSilver538: "NS",
  unusual_whales: "UW",
  DeribitExchange: "DB",
  Sabortoothkitty: "STK",
  tier10k: "T10K",
};
