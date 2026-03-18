import type { WhaleTrade, ProcessedMarket, SmartWallet, NewsItem } from "@/types";
import { detectSignals } from "./smartSignals";

export type UnifiedSignalType =
  | "top_wallet_entry"      // Top-50 PnL wallet opens a position
  | "top_cluster"           // ≥3 top-50 wallets buy same market within 1h
  | "news_catalyst"         // News + smart money activity on same market
  | "whale_accumulation"
  | "smart_divergence"
  | "cluster_activity"
  | "momentum_shift";

export interface UnifiedSignal {
  id: string;
  type: UnifiedSignalType;
  strength: "strong" | "moderate" | "weak";
  market: { title: string; slug: string; prob: number | null };
  wallets: Array<{ address: string; username: string | null; rank?: number; pnl?: number }>;
  direction: "bullish" | "bearish";
  /** The outcome name being bought/sold (e.g. "Trump", "Yes", "Over 50k") */
  outcomeName?: string;
  /** Sub-market question title when event has multiple markets (e.g. "Man City to advance?") */
  subMarketTitle?: string;
  summary: string;
  timestamp: number;
  details: {
    totalVolume?: number;
    tradeCount?: number;
    smartRatio?: number;
    priceAtSignal?: number;
    newsTitle?: string;
    newsSource?: string;
  };
}

/** Find the most common outcome name from a set of trades */
function dominantOutcome(trades: WhaleTrade[]): string | undefined {
  if (trades.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const t of trades) {
    if (t.outcome) counts.set(t.outcome, (counts.get(t.outcome) || 0) + t.usdcSize);
  }
  let best = "";
  let bestVol = 0;
  for (const [name, vol] of counts) {
    if (vol > bestVol) { best = name; bestVol = vol; }
  }
  return best || undefined;
}

/** Find the dominant sub-market title (WhaleTrade.title) by volume.
 *  Returns undefined if all trades share the same title as the parent event. */
function dominantSubMarket(trades: WhaleTrade[], parentTitle: string): string | undefined {
  if (trades.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const t of trades) {
    if (t.title && t.title !== parentTitle) {
      counts.set(t.title, (counts.get(t.title) || 0) + t.usdcSize);
    }
  }
  if (counts.size === 0) return undefined;
  let best = "";
  let bestVol = 0;
  for (const [name, vol] of counts) {
    if (vol > bestVol) { best = name; bestVol = vol; }
  }
  return best || undefined;
}

const SIGNAL_ICONS: Record<UnifiedSignalType, string> = {
  top_wallet_entry: "\u{1F451}",   // crown
  top_cluster: "\u{1F3AF}",        // target
  news_catalyst: "\u{1F4F0}",      // newspaper
  whale_accumulation: "\u{1F40B}", // whale
  smart_divergence: "\u26A1",      // lightning
  cluster_activity: "\u{1F465}",   // people
  momentum_shift: "\u{1F504}",     // cycle
};

export function getSignalIcon(type: UnifiedSignalType): string {
  return SIGNAL_ICONS[type] || "\u{1F514}";
}

const STRENGTH_RANK = { strong: 3, moderate: 2, weak: 1 };

/** Common English stopwords that should never be used for news-market matching */
const STOPWORDS = new Set([
  "will", "would", "could", "should", "does", "have", "been", "being",
  "were", "what", "when", "where", "which", "while", "with", "from",
  "into", "over", "under", "about", "above", "below", "before", "after",
  "between", "through", "during", "again", "further", "then", "than",
  "that", "this", "these", "those", "there", "their", "they", "them",
  "some", "such", "more", "most", "other", "each", "every", "both",
  "much", "many", "same", "also", "back", "well", "just", "only",
  "very", "even", "still", "already", "close", "open", "step", "down",
  "make", "take", "come", "give", "keep", "says", "said", "named",
  "market", "price", "next", "last", "first", "best", "long", "high",
]);

function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function makeId(type: string, slug: string, extra: string): string {
  return `${type}_${slug}_${extra}`;
}

/**
 * Build a lookup of top-N wallets by PnL from the leaderboard.
 */
function buildTopWalletSet(leaderboard: SmartWallet[], topN = 50): Map<string, SmartWallet> {
  const map = new Map<string, SmartWallet>();
  const sorted = [...leaderboard].sort((a, b) => b.pnl - a.pnl);
  for (let i = 0; i < Math.min(topN, sorted.length); i++) {
    map.set(sorted[i].address.toLowerCase(), sorted[i]);
  }
  return map;
}

/**
 * Detect "top wallet entry" signals: any top-50 PnL wallet buying in the last hour.
 */
function detectTopWalletEntries(
  trades: WhaleTrade[],
  topWallets: Map<string, SmartWallet>,
  markets: ProcessedMarket[],
): UnifiedSignal[] {
  if (topWallets.size === 0) return [];

  const signals: UnifiedSignal[] = [];
  const now = Date.now();
  const cutoff1h = now - 3600_000;

  const recentBuys = trades.filter(
    (t) => t.side === "BUY" && new Date(t.timestamp).getTime() >= cutoff1h
  );

  // Group by market slug
  const bySlug = new Map<string, WhaleTrade[]>();
  for (const t of recentBuys) {
    const addr = t.wallet.toLowerCase();
    if (!topWallets.has(addr)) continue;
    if (!bySlug.has(t.slug)) bySlug.set(t.slug, []);
    bySlug.get(t.slug)!.push(t);
  }

  for (const [slug, slugTrades] of bySlug) {
    const market = markets.find((m) => m.slug === slug);
    if (!market) continue;

    // Each unique top wallet = one signal
    const seenWallets = new Set<string>();
    for (const t of slugTrades) {
      const addr = t.wallet.toLowerCase();
      if (seenWallets.has(addr)) continue;
      seenWallets.add(addr);

      const wallet = topWallets.get(addr)!;
      const walletTrades = slugTrades.filter((x) => x.wallet.toLowerCase() === addr);
      const vol = walletTrades.reduce((s, x) => s + x.usdcSize, 0);
      const tradeCount = walletTrades.length;

      signals.push({
        id: makeId("top_wallet_entry", slug, addr.slice(0, 8)),
        type: "top_wallet_entry",
        strength: vol >= 20000 ? "strong" : vol >= 5000 ? "moderate" : "weak",
        market: { title: market.title, slug, prob: market.prob },
        wallets: [{
          address: wallet.address,
          username: wallet.username,
          rank: wallet.rank,
          pnl: wallet.pnl,
        }],
        direction: "bullish",
        outcomeName: dominantOutcome(walletTrades),
        subMarketTitle: dominantSubMarket(walletTrades, market.title),
        summary: `Top-${wallet.rank} trader ${wallet.username || wallet.address.slice(0, 8)} bought ${market.title} ($${(vol / 1000).toFixed(1)}k)`,
        timestamp: Math.max(...walletTrades.map((x) => new Date(x.timestamp).getTime())),
        details: { totalVolume: vol, tradeCount, priceAtSignal: market.prob ?? undefined },
      });
    }
  }

  return signals;
}

/**
 * Detect "top cluster" signals: ≥3 top-50 wallets buying same market within 1h.
 * This is the strongest signal type.
 */
function detectTopCluster(
  trades: WhaleTrade[],
  topWallets: Map<string, SmartWallet>,
  markets: ProcessedMarket[],
): UnifiedSignal[] {
  if (topWallets.size === 0) return [];

  const signals: UnifiedSignal[] = [];
  const now = Date.now();
  const cutoff1h = now - 3600_000;

  const recentTopBuys = trades.filter((t) => {
    if (t.side !== "BUY") return false;
    if (new Date(t.timestamp).getTime() < cutoff1h) return false;
    return topWallets.has(t.wallet.toLowerCase());
  });

  // Group by slug
  const bySlug = new Map<string, WhaleTrade[]>();
  for (const t of recentTopBuys) {
    if (!bySlug.has(t.slug)) bySlug.set(t.slug, []);
    bySlug.get(t.slug)!.push(t);
  }

  for (const [slug, slugTrades] of bySlug) {
    const uniqueWallets = new Map<string, WhaleTrade>();
    for (const t of slugTrades) {
      const addr = t.wallet.toLowerCase();
      if (!uniqueWallets.has(addr)) uniqueWallets.set(addr, t);
    }

    if (uniqueWallets.size < 3) continue;

    const market = markets.find((m) => m.slug === slug);
    if (!market) continue;

    const totalVol = slugTrades.reduce((s, t) => s + t.usdcSize, 0);
    const walletInfos = Array.from(uniqueWallets.entries()).map(([addr]) => {
      const w = topWallets.get(addr)!;
      return { address: w.address, username: w.username, rank: w.rank, pnl: w.pnl };
    });

    signals.push({
      id: makeId("top_cluster", slug, String(uniqueWallets.size)),
      type: "top_cluster",
      strength: "strong", // Always strong — this is the #1 signal
      market: { title: market.title, slug, prob: market.prob },
      wallets: walletInfos,
      direction: "bullish",
      outcomeName: dominantOutcome(slugTrades),
      subMarketTitle: dominantSubMarket(slugTrades, market.title),
      summary: `${uniqueWallets.size} top-50 traders bought ${market.title} in past 1h ($${(totalVol / 1000).toFixed(1)}k total)`,
      timestamp: Math.max(...slugTrades.map((t) => new Date(t.timestamp).getTime())),
      details: { totalVolume: totalVol, tradeCount: slugTrades.length, priceAtSignal: market.prob ?? undefined },
    });
  }

  return signals;
}

/**
 * Detect "news catalyst" signals: recent news matching a market where smart money is also active.
 */
function detectNewsCatalyst(
  trades: WhaleTrade[],
  markets: ProcessedMarket[],
  news: NewsItem[],
): UnifiedSignal[] {
  const signals: UnifiedSignal[] = [];
  const now = Date.now();
  const cutoff2h = now - 2 * 3600_000;

  // Recent smart trades grouped by slug
  const recentBySlug = new Map<string, WhaleTrade[]>();
  for (const t of trades) {
    if (!t.isSmartWallet) continue;
    if (new Date(t.timestamp).getTime() < cutoff2h) continue;
    if (!recentBySlug.has(t.slug)) recentBySlug.set(t.slug, []);
    recentBySlug.get(t.slug)!.push(t);
  }

  if (recentBySlug.size === 0) return [];

  // Recent news (last 2h)
  const recentNews = news.filter((n) => {
    const pubTime = new Date(n.publishedAt).getTime();
    return pubTime >= cutoff2h;
  });

  if (recentNews.length === 0) return [];

  // For each market with smart money activity, check if there's related news
  for (const [slug, slugTrades] of recentBySlug) {
    const market = markets.find((m) => m.slug === slug);
    if (!market) continue;

    // Extract meaningful keywords from market title (skip stopwords, short words)
    const titleWords = extractKeywords(market.title);
    if (titleWords.length < 2) continue;

    // Require at least 2 keyword matches to avoid false positives
    const matchingNews = recentNews.find((n) => {
      const newsLower = (n.title + " " + (n.summary || "")).toLowerCase();
      const hits = titleWords.filter((w) => newsLower.includes(w));
      return hits.length >= 2;
    });

    if (!matchingNews) continue;

    const buys = slugTrades.filter((t) => t.side === "BUY");
    const sells = slugTrades.filter((t) => t.side === "SELL");
    const netBuy = buys.reduce((s, t) => s + t.usdcSize, 0) - sells.reduce((s, t) => s + t.usdcSize, 0);
    const direction = netBuy > 0 ? "bullish" : "bearish";
    const totalVol = slugTrades.reduce((s, t) => s + t.usdcSize, 0);

    const uniqueWallets = new Map<string, string | null>();
    for (const t of slugTrades) {
      if (!uniqueWallets.has(t.wallet)) uniqueWallets.set(t.wallet, t.username ?? null);
    }

    signals.push({
      id: makeId("news_catalyst", slug, matchingNews.id.slice(0, 8)),
      type: "news_catalyst",
      strength: totalVol >= 20000 ? "strong" : totalVol >= 5000 ? "moderate" : "weak",
      market: { title: market.title, slug, prob: market.prob },
      wallets: Array.from(uniqueWallets.entries()).map(([address, username]) => ({ address, username })),
      direction: direction as "bullish" | "bearish",
      outcomeName: dominantOutcome(direction === "bullish" ? buys : sells) || dominantOutcome(slugTrades),
      subMarketTitle: dominantSubMarket(slugTrades, market.title),
      summary: `News "${matchingNews.title.slice(0, 60)}" + smart money ${direction} on ${market.title}`,
      timestamp: Math.max(
        new Date(matchingNews.publishedAt).getTime(),
        ...slugTrades.map((t) => new Date(t.timestamp).getTime())
      ),
      details: {
        totalVolume: totalVol,
        tradeCount: slugTrades.length,
        priceAtSignal: market.prob ?? undefined,
        newsTitle: matchingNews.title,
        newsSource: matchingNews.source,
      },
    });
  }

  return signals;
}

/** Resolution alert input (used by ResolutionPanel) */
export interface ResolutionAlertInput {
  id: number;
  eventId: string;
  title: string;
  url: string;
  source: string;
  detectedAt: string;
  marketTitle: string;
  slug: string;
  prob: number | null;
  endDate: string | null;
  category: string | null;
}

/**
 * Main entry: combine all signal sources into a unified, deduplicated, ranked list.
 */
export function generateSignals(
  trades: WhaleTrade[],
  markets: ProcessedMarket[],
  leaderboard: SmartWallet[],
  news: NewsItem[],
): UnifiedSignal[] {
  const topWallets = buildTopWalletSet(leaderboard, 50);

  // 1. Top cluster (strongest)
  const topCluster = detectTopCluster(trades, topWallets, markets);

  // 2. Top wallet entries
  const topEntries = detectTopWalletEntries(trades, topWallets, markets);

  // 3. News catalysts
  const newsCatalysts = detectNewsCatalyst(trades, markets, news);

  // 4. Existing smart signals (whale_accumulation, smart_divergence, cluster_activity, momentum_shift)
  const smartSignals = detectSignals(trades, markets, 6);
  const converted: UnifiedSignal[] = smartSignals.map((s) => {
    const slugTrades = trades.filter((t) => t.slug === s.market.slug);
    const dirTrades = s.direction === "bullish"
      ? slugTrades.filter((t) => t.side === "BUY")
      : slugTrades.filter((t) => t.side === "SELL");
    return {
      ...s,
      type: s.type as UnifiedSignalType,
      wallets: s.wallets.map((w) => ({ ...w, rank: undefined, pnl: undefined })),
      outcomeName: dominantOutcome(dirTrades) || dominantOutcome(slugTrades),
      subMarketTitle: dominantSubMarket(slugTrades, s.market.title),
    };
  });

  // Combine all
  const all = [...topCluster, ...topEntries, ...newsCatalysts, ...converted];

  // Deduplicate: keep strongest per (type, slug)
  const deduped = new Map<string, UnifiedSignal>();
  for (const sig of all) {
    const key = `${sig.type}_${sig.market.slug}`;
    const existing = deduped.get(key);
    if (!existing || STRENGTH_RANK[sig.strength] > STRENGTH_RANK[existing.strength]) {
      deduped.set(key, sig);
    }
  }

  // Sort: strong first, then by timestamp DESC
  return Array.from(deduped.values()).sort((a, b) => {
    const sr = STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength];
    if (sr !== 0) return sr;
    return b.timestamp - a.timestamp;
  });
}
