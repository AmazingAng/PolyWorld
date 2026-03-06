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

/**
 * Fetch a single page of leaderboard entries.
 */
export async function fetchLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  try {
    const res = await rateLimitedFetch(
      `${DATA_API_BASE}/v1/leaderboard?orderBy=PNL&timePeriod=ALL&limit=${limit}`
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
        `${DATA_API_BASE}/v1/leaderboard?orderBy=PNL&timePeriod=ALL&limit=${PAGE_SIZE}&offset=${offset}`
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
