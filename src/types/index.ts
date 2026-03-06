export interface PolymarketEvent {
  id: string;
  title: string;
  slug: string;
  description?: string;
  markets: PolymarketMarket[];
  volume?: number;
  volume_num?: number;
  volume_24hr?: number;
  volume24hr?: number;
  liquidity?: number;
  tags?: Array<{ id?: number; label?: string; name?: string; slug?: string }>;
  oneDayPriceChange?: number;
  active?: boolean;
  closed?: boolean;
  endDate?: string;
  resolutionSource?: string;
  image?: string;
  commentCount?: number;
  startDate?: string;
  createdAt?: string;
}

export interface PolymarketMarket {
  id: string;
  question?: string;
  groupItemTitle?: string;
  clobTokenIds?: string[] | string;
  outcomePrices?: string[] | string;
  outcomes?: string[];
  volume?: number;
  volume_24hr?: number;
  oneDayPriceChange?: number;
  liquidity?: number;
  active?: boolean;
  closed?: boolean;
}

export type Category =
  | "Politics"
  | "Geopolitics"
  | "Crypto"
  | "Sports"
  | "Finance"
  | "Tech"
  | "Culture"
  | "Other";

export type ImpactLevel = "critical" | "high" | "medium" | "low" | "info";

export interface AnomalyInfo {
  zScore: number;
  isAnomaly: boolean;
  direction: "up" | "down" | "neutral";
  volumeSpike: boolean;
}

export interface ProcessedMarket {
  id: string;
  marketId: string;
  title: string;
  slug: string;
  category: Category;
  volume: number;
  volume24h: number;
  prob: number | null;
  change: number | null;
  recentChange: number | null;
  markets: PolymarketMarket[];
  location: string | null;
  coords: [number, number] | null;
  createdAt?: string | null;
  // P1 fields
  description: string | null;
  resolutionSource: string | null;
  endDate: string | null;
  image: string | null;
  // P2 fields
  liquidity: number;
  active: boolean;
  closed: boolean;
  commentCount: number;
  tags: string[];
  // Intelligence fields
  impactScore: number;
  impactLevel: ImpactLevel;
  anomaly?: AnomalyInfo;
  smartMoney?: SmartMoneyFlow | null;
}

export interface GeoResult {
  coords: [number, number];
  location: string;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceUrl: string;
  summary: string | null;
  publishedAt: string;
  imageUrl: string | null;
  categories: string[];
}

export interface NewsSource {
  name: string;
  feedUrl: string;
  region: string;
}

export interface SmartWallet {
  address: string;
  username: string | null;
  pnl: number;
  volume: number;
  rank: number;
  profileImage: string | null;
}

export interface WhaleTrade {
  wallet: string;
  username?: string;
  conditionId: string;
  eventId: string | null;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  usdcSize: number;
  outcome: string;
  title: string;
  slug: string;
  timestamp: string;
  isSmartWallet: boolean;
}

export interface OrderBookLevel {
  price: number;
  size: number;
  cumSize: number;
}

export interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastTradePrice: number;
  spread: number;
  midPrice: number;
  tickSize: number;
}

export interface SentimentSubScore {
  name: string;
  value: number;
  weight: number;
}

export interface SentimentIndex {
  score: number;
  label: string;
  subScores: SentimentSubScore[];
  activeMarkets: number;
  updatedAt: string;
}

export interface SmartMoneyFlow {
  smartBuys: number;
  smartSells: number;
  whaleBuys: number;
  whaleSells: number;
  netFlow: "bullish" | "bearish" | "neutral";
  topWallets: Array<{ address: string; username: string | null; side: "BUY" | "SELL"; size: number }>;
  recentTrades: WhaleTrade[];
}
