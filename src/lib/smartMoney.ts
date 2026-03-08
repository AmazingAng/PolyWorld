const DATA_API_BASE = "https://data-api.polymarket.com";
const REQUEST_TIMEOUT = 10_000;
const RATE_LIMIT_MS = 200;

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastRequestTime);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

export interface LeaderboardEntry {
  address: string;
  username: string | null;
  profileImage: string | null;
  pnl: number;
  volume: number;
  rank: number;
}

/**
 * Actual API response shape (array):
 * { rank: "1", proxyWallet: "0x...", userName: "Theo4", vol: 43251303, pnl: 22053933, profileImage: "" }
 */
function parseLeaderboardEntries(data: Record<string, unknown>[]): LeaderboardEntry[] {
  return data.map((e, i) => ({
    address: String(e.proxyWallet || e.address || e.wallet || ""),
    username: (e.userName || e.username || null) as string | null,
    profileImage: ((e.profileImage || e.profileImageOptimized || null) as string | null) || null,
    pnl: parseFloat(String(e.pnl || 0)),
    volume: parseFloat(String(e.vol || e.volume || 0)),
    rank: parseInt(String(e.rank), 10) || i + 1,
  }));
}

export type LeaderboardTimePeriod = "day" | "week" | "month" | "all";

/**
 * Fetch a single page of leaderboard entries.
 */
export async function fetchLeaderboard(limit = 50, timePeriod: LeaderboardTimePeriod = "all"): Promise<LeaderboardEntry[]> {
  try {
    const res = await rateLimitedFetch(
      `${DATA_API_BASE}/v1/leaderboard?orderBy=PNL&timePeriod=${timePeriod}&limit=${limit}`
    );
    if (!res.ok) {
      console.error(`[smartMoney] Leaderboard fetch failed: ${res.status}`);
      return [];
    }
    const data = await res.json();
    const entries = Array.isArray(data) ? data : data.leaderboard || data.data || [];
    return parseLeaderboardEntries(entries);
  } catch (err) {
    console.error("[smartMoney] Leaderboard fetch error:", err);
    return [];
  }
}

/**
 * Fetch ALL leaderboard entries with PnL >= minPnl by paginating (50 per page).
 */
export async function fetchFullLeaderboard(minPnl = 100_000): Promise<LeaderboardEntry[]> {
  const PAGE_SIZE = 50;
  const all: LeaderboardEntry[] = [];
  let offset = 0;

  try {
    while (true) {
      const res = await rateLimitedFetch(
        `${DATA_API_BASE}/v1/leaderboard?orderBy=PNL&timePeriod=all&limit=${PAGE_SIZE}&offset=${offset}`
      );
      if (!res.ok) break;
      const data = await res.json();
      const raw = Array.isArray(data) ? data : data.leaderboard || data.data || [];
      if (raw.length === 0) break;

      const entries = parseLeaderboardEntries(raw);
      for (const e of entries) {
        if (e.pnl < minPnl) return all; // sorted by PnL desc, so we can stop
        all.push(e);
      }

      if (raw.length < PAGE_SIZE) break; // last page
      offset += PAGE_SIZE;
    }
  } catch (err) {
    console.error("[smartMoney] Full leaderboard fetch error:", err);
  }

  return all;
}

export interface MarketTrade {
  wallet: string;
  username: string | null;
  conditionId: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  usdcSize: number;
  outcome: string;
  timestamp: string;
  title: string;
  slug: string;
  eventSlug: string;
}

/**
 * Actual API response shape (array):
 * { proxyWallet: "0x...", side: "BUY"|"SELL", size: 5536.88, price: 0.931,
 *   timestamp: 1772733417 (unix seconds), title: "...", slug: "...", eventSlug: "...",
 *   outcome: "No", name: "Hyperlong", pseudonym: "Bold-Steward", conditionId: "0x..." }
 */
export async function fetchMarketTrades(
  conditionId: string,
  minAmount = 5000
): Promise<MarketTrade[]> {
  try {
    const marketParam = conditionId ? `market=${conditionId}&` : "";
    // Use smaller limit for fresher data from the API (larger limits return staler cached results)
    const limit = conditionId ? 100 : 20;
    const res = await rateLimitedFetch(
      `${DATA_API_BASE}/trades?${marketParam}filterType=CASH&filterAmount=${minAmount}&limit=${limit}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const trades = Array.isArray(data) ? data : data.trades || data.data || [];
    return trades.map((t: Record<string, unknown>) => {
      // timestamp may be unix seconds (number) or ISO string
      let ts = t.timestamp;
      if (typeof ts === "number") {
        // If it looks like seconds (< 10 billion), convert to ms
        ts = ts < 1e12 ? new Date(ts * 1000).toISOString() : new Date(ts).toISOString();
      }

      const usdcSize = parseFloat(String(t.size || 0)) * parseFloat(String(t.price || 1));

      return {
        wallet: String(t.proxyWallet || t.wallet || t.maker || ""),
        username: (t.name || t.userName || t.pseudonym || null) as string | null,
        conditionId: String(t.conditionId || conditionId),
        side: (String(t.side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY") as "BUY" | "SELL",
        size: parseFloat(String(t.size || 0)),
        price: parseFloat(String(t.price || 0)),
        usdcSize,
        outcome: String(t.outcome || ""),
        timestamp: String(ts || new Date().toISOString()),
        title: String(t.title || ""),
        slug: String(t.slug || ""),
        eventSlug: String(t.eventSlug || t.slug || ""),
      };
    });
  } catch (err) {
    console.error(`[smartMoney] Trade fetch error for ${conditionId}:`, err);
    return [];
  }
}

export interface HolderInfo {
  wallet: string;
  amount: number;
  outcome: string;
}

export async function fetchTopHolders(conditionId: string): Promise<HolderInfo[]> {
  try {
    const res = await rateLimitedFetch(
      `${DATA_API_BASE}/holders?market=${conditionId}&limit=50`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const holders = Array.isArray(data) ? data : data.holders || data.data || [];
    return holders.map((h: Record<string, unknown>) => ({
      wallet: String(h.proxyWallet || h.address || h.wallet || ""),
      amount: parseFloat(String(h.amount || h.balance || h.shares || 0)),
      outcome: String(h.outcome || ""),
    }));
  } catch (err) {
    console.error(`[smartMoney] Holders fetch error for ${conditionId}:`, err);
    return [];
  }
}

export interface WalletPosition {
  conditionId: string;
  outcome: string;
  size: number;
  value: number;
}

export async function fetchWalletPositions(wallet: string): Promise<WalletPosition[]> {
  try {
    const res = await rateLimitedFetch(
      `${DATA_API_BASE}/positions?user=${wallet}&sortBy=CURRENT&limit=100`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const positions = Array.isArray(data) ? data : data.positions || data.data || [];
    return positions.map((p: Record<string, unknown>) => ({
      conditionId: String(p.conditionId || p.market || ""),
      outcome: String(p.outcome || ""),
      size: parseFloat(String(p.size || p.shares || 0)),
      value: parseFloat(String(p.currentValue || p.value || 0)),
    }));
  } catch (err) {
    console.error(`[smartMoney] Positions fetch error for ${wallet}:`, err);
    return [];
  }
}

/* ─── Trader Panel data layer ─── */

export interface TraderPosition {
  conditionId: string;
  title: string;
  outcome: string;
  size: number;
  avgPrice: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  redeemed: boolean;
}

export interface TraderActivity {
  timestamp: string;
  type: "TRADE" | "SPLIT" | "MERGE" | "REDEEM";
  title: string;
  outcome: string;
  side: "BUY" | "SELL";
  size: number;
  usdcSize: number;
  price: number;
  transactionHash: string;
}

function parseTraderPosition(p: Record<string, unknown>, redeemed: boolean): TraderPosition {
  if (redeemed) {
    // Closed positions: API provides totalBought, realizedPnl, avgPrice, curPrice — no size/currentValue
    const totalBought = parseFloat(String(p.totalBought || 0));
    const avgPrice = parseFloat(String(p.avgPrice || p.averagePrice || 0));
    const realizedPnl = parseFloat(String(p.realizedPnl || 0));
    const cost = avgPrice > 0 ? totalBought * avgPrice : totalBought;
    return {
      conditionId: String(p.conditionId || p.market || ""),
      title: String(p.title || p.marketTitle || p.question || ""),
      outcome: String(p.outcome || ""),
      size: totalBought,
      avgPrice,
      currentValue: cost + realizedPnl,
      cashPnl: realizedPnl,
      percentPnl: cost > 0 ? (realizedPnl / cost) * 100 : 0,
      redeemed: true,
    };
  }
  // Open positions: API provides cashPnl, percentPnl directly
  const size = parseFloat(String(p.size || p.shares || 0));
  const avgPrice = parseFloat(String(p.avgPrice || p.averagePrice || 0));
  const currentValue = parseFloat(String(p.currentValue || p.value || 0));
  const cashPnl = typeof p.cashPnl === "number" ? p.cashPnl : parseFloat(String(p.cashPnl || 0));
  const percentPnl = typeof p.percentPnl === "number" ? p.percentPnl : parseFloat(String(p.percentPnl || 0));
  return {
    conditionId: String(p.conditionId || p.market || ""),
    title: String(p.title || p.marketTitle || p.question || ""),
    outcome: String(p.outcome || ""),
    size,
    avgPrice,
    currentValue,
    cashPnl,
    percentPnl,
    redeemed: false,
  };
}

export async function fetchTraderPositions(wallet: string): Promise<TraderPosition[]> {
  try {
    const [openRes, closedRes] = await Promise.all([
      rateLimitedFetch(`${DATA_API_BASE}/positions?user=${wallet}&sortBy=CURRENT&limit=200`),
      rateLimitedFetch(`${DATA_API_BASE}/closed-positions?user=${wallet}&limit=200`),
    ]);
    const openData = openRes.ok ? await openRes.json() : [];
    const closedData = closedRes.ok ? await closedRes.json() : [];
    const openArr = Array.isArray(openData) ? openData : openData.positions || openData.data || [];
    const closedArr = Array.isArray(closedData) ? closedData : closedData.positions || closedData.data || [];
    return [
      ...openArr.map((p: Record<string, unknown>) => parseTraderPosition(p, false)),
      ...closedArr.map((p: Record<string, unknown>) => parseTraderPosition(p, true)),
    ];
  } catch (err) {
    console.error(`[smartMoney] Trader positions fetch error for ${wallet}:`, err);
    return [];
  }
}

export async function fetchTraderActivity(wallet: string, limit = 100): Promise<TraderActivity[]> {
  try {
    const res = await rateLimitedFetch(
      `${DATA_API_BASE}/activity?user=${wallet}&limit=${limit}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data) ? data : data.activity || data.data || [];
    return items.map((a: Record<string, unknown>) => {
      let ts = a.timestamp;
      if (typeof ts === "number") {
        ts = ts < 1e12 ? new Date(ts * 1000).toISOString() : new Date(ts).toISOString();
      }
      const rawType = String(a.type || a.action || "TRADE").toUpperCase();
      const type = (["TRADE", "SPLIT", "MERGE", "REDEEM"].includes(rawType) ? rawType : "TRADE") as TraderActivity["type"];
      return {
        timestamp: String(ts || new Date().toISOString()),
        type,
        title: String(a.title || a.marketTitle || a.question || ""),
        outcome: String(a.outcome || ""),
        side: (String(a.side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY") as "BUY" | "SELL",
        size: parseFloat(String(a.size || a.shares || 0)),
        usdcSize: parseFloat(String(a.usdcSize || a.amount || 0)) || parseFloat(String(a.size || 0)) * parseFloat(String(a.price || 0)),
        price: parseFloat(String(a.price || 0)),
        transactionHash: String(a.transactionHash || a.txHash || a.hash || ""),
      };
    });
  } catch (err) {
    console.error(`[smartMoney] Trader activity fetch error for ${wallet}:`, err);
    return [];
  }
}

export async function fetchTraderValue(wallet: string): Promise<number> {
  try {
    const res = await rateLimitedFetch(`${DATA_API_BASE}/value?user=${wallet}`);
    if (!res.ok) return 0;
    const data = await res.json();
    if (typeof data === "number") return data;
    // API returns [{user, value}] array
    if (Array.isArray(data)) return parseFloat(String(data[0]?.value || 0));
    return parseFloat(String(data.value || data.totalValue || 0));
  } catch (err) {
    console.error(`[smartMoney] Trader value fetch error for ${wallet}:`, err);
    return 0;
  }
}
