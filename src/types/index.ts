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
