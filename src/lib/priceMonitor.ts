/**
 * Price monitoring for crypto, stock, and commodity resolution sources.
 *
 * Fetches live prices from Binance (crypto) and Yahoo Finance (stocks/commodities),
 * compares against market thresholds to generate resolution alerts.
 */

// ── Price fetching ──

const priceCache = new Map<string, { price: number; ts: number }>();
const CACHE_TTL = 30_000; // 30s

async function fetchBinancePrice(symbol: string): Promise<number | null> {
  if (!/^[A-Z0-9]{2,20}$/.test(symbol)) return null;

  const cached = priceCache.get(`binance:${symbol}`);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.price;

  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const price = parseFloat(data.price);
    if (isNaN(price)) return null;
    priceCache.set(`binance:${symbol}`, { price, ts: Date.now() });
    return price;
  } catch {
    return null;
  }
}

async function fetchYahooPrice(symbol: string): Promise<number | null> {
  if (!/^[\w^=.]{1,20}$/.test(symbol)) return null;

  const cached = priceCache.get(`yahoo:${symbol}`);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.price;

  try {
    // Yahoo Finance v8 API (public, no auth needed)
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== "number" || isNaN(price)) return null;
    priceCache.set(`yahoo:${symbol}`, { price, ts: Date.now() });
    return price;
  } catch {
    return null;
  }
}

export async function fetchPrice(provider: string, symbol: string): Promise<number | null> {
  if (provider === "binance") return fetchBinancePrice(symbol);
  if (provider === "yahoo" || provider === "cme") return fetchYahooPrice(symbol);
  return null;
}

// ── Candle open price for Up/Down markets ──

const openPriceCache = new Map<string, { open: number; ts: number }>();
const OPEN_CACHE_TTL = 60_000; // 1min

/**
 * Fetch the daily candle open price from Binance.
 * Used for "Up or Down" markets that resolve based on open vs close.
 */
export async function fetchBinanceDailyOpen(symbol: string): Promise<number | null> {
  const cacheKey = `open:${symbol}`;
  const cached = openPriceCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < OPEN_CACHE_TTL) return cached.open;

  try {
    // Fetch current daily kline (1d interval, limit 1 = current candle)
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=1`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    // Kline format: [openTime, open, high, low, close, ...]
    if (!Array.isArray(data) || data.length === 0) return null;
    const open = parseFloat(data[0][1]);
    if (isNaN(open)) return null;
    openPriceCache.set(cacheKey, { open, ts: Date.now() });
    return open;
  } catch {
    return null;
  }
}

export interface CandleDirection {
  symbol: string;
  openPrice: number;
  currentPrice: number;
  changePercent: number;
  direction: "up" | "down";
}

/**
 * Get candle direction info: compare daily open to current price.
 */
export async function getCandleDirection(symbol: string): Promise<CandleDirection | null> {
  const [current, open] = await Promise.all([
    fetchBinancePrice(symbol),
    fetchBinanceDailyOpen(symbol),
  ]);
  if (current === null || open === null || open === 0) return null;

  const changePercent = Math.round(((current - open) / open) * 1000) / 10;
  return {
    symbol,
    openPrice: open,
    currentPrice: current,
    changePercent,
    direction: current >= open ? "up" : "down",
  };
}

// ── Threshold parsing from market titles ──

export interface PriceThreshold {
  value: number;
  direction: "above" | "below";
}

/**
 * Extract price threshold from market title.
 * Handles patterns like:
 *   "Will Tesla (TSLA) close above $350 end of March?" → { value: 350, direction: "above" }
 *   "Bitcoin above $100,000 on March 31?" → { value: 100000, direction: "above" }
 *   "↑ $280" (outcome label) → { value: 280, direction: "above" }
 *   "↓ $192" (outcome label) → { value: 192, direction: "below" }
 */
export function parseThresholdFromTitle(title: string): PriceThreshold | null {
  // Pattern 1: explicit direction words + dollar amount
  const directionMatch = title.match(
    /\b(above|below|over|under|exceed|hit|reach|close\s+above|close\s+below)\b.*?\$\s?([\d,]+(?:\.\d+)?)/i
  );
  if (directionMatch) {
    const dir = directionMatch[1].toLowerCase();
    const value = parseFloat(directionMatch[2].replace(/,/g, ""));
    if (!isNaN(value)) {
      const direction = dir.includes("below") || dir.includes("under") ? "below" : "above";
      return { value, direction };
    }
  }

  // Pattern 2: dollar amount + direction words
  const reverseMatch = title.match(
    /\$\s?([\d,]+(?:\.\d+)?)\s*.*?\b(above|below|over|under)\b/i
  );
  if (reverseMatch) {
    const value = parseFloat(reverseMatch[1].replace(/,/g, ""));
    const dir = reverseMatch[2].toLowerCase();
    if (!isNaN(value)) {
      const direction = dir.includes("below") || dir.includes("under") ? "below" : "above";
      return { value, direction };
    }
  }

  return null;
}

/**
 * Parse threshold from outcome labels (multi-outcome markets).
 * Returns all thresholds from outcome labels like "↑ $280", "↓ $192".
 */
export function parseThresholdsFromOutcomes(marketsJson: string): PriceThreshold[] {
  try {
    const markets = JSON.parse(marketsJson || "[]") as Array<{
      groupItemTitle?: string;
      question?: string;
    }>;
    const thresholds: PriceThreshold[] = [];
    for (const m of markets) {
      const label = m.groupItemTitle || m.question || "";
      // ↑ $280 or ↓ $192
      const arrowMatch = label.match(/([↑↓])\s*\$\s?([\d,]+(?:\.\d+)?)/);
      if (arrowMatch) {
        const value = parseFloat(arrowMatch[2].replace(/,/g, ""));
        if (!isNaN(value)) {
          thresholds.push({
            value,
            direction: arrowMatch[1] === "↑" ? "above" : "below",
          });
        }
        continue;
      }
      // Plain "$350" outcome label (common in "close above ___" markets)
      const plainMatch = label.match(/^\$\s?([\d,]+(?:\.\d+)?)\s*$/);
      if (plainMatch) {
        const value = parseFloat(plainMatch[1].replace(/,/g, ""));
        if (!isNaN(value)) {
          thresholds.push({ value, direction: "above" });
        }
      }
    }
    return thresholds;
  } catch {
    return [];
  }
}

// ── Alert generation ──

export interface PriceAlert {
  eventId: string;
  currentPrice: number;
  threshold: number;
  direction: "above" | "below";
  distancePercent: number;
  symbol: string;
  provider: string;
}

const PROXIMITY_PERCENT = 5; // Alert when price is within 5% of threshold

/**
 * Check a single monitor for price proximity alerts.
 * Returns alerts for thresholds that the current price is within PROXIMITY_PERCENT of.
 */
export function checkPriceProximity(
  eventId: string,
  currentPrice: number,
  thresholds: PriceThreshold[],
  symbol: string,
  provider: string,
): PriceAlert[] {
  const alerts: PriceAlert[] = [];

  for (const { value, direction } of thresholds) {
    const distance = Math.abs(currentPrice - value) / value;
    const distancePercent = Math.round(distance * 1000) / 10; // 1 decimal

    if (distancePercent > PROXIMITY_PERCENT) continue;

    // Check if price is approaching the threshold from the "right" side
    const isApproaching =
      (direction === "above" && currentPrice <= value) ||
      (direction === "below" && currentPrice >= value);
    // Also alert if already crossed (resolution imminent)
    const hasCrossed =
      (direction === "above" && currentPrice > value) ||
      (direction === "below" && currentPrice < value);

    if (isApproaching || hasCrossed) {
      alerts.push({
        eventId,
        currentPrice,
        threshold: value,
        direction,
        distancePercent,
        symbol,
        provider,
      });
    }
  }

  return alerts;
}

/**
 * Format a price alert as a human-readable title for the resolution_alerts table.
 */
export function formatPriceAlertTitle(alert: PriceAlert): string {
  const priceStr = alert.currentPrice >= 1000
    ? `$${alert.currentPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : `$${alert.currentPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const threshStr = alert.threshold >= 1000
    ? `$${alert.threshold.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : `$${alert.threshold.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

  const crossed =
    (alert.direction === "above" && alert.currentPrice > alert.threshold) ||
    (alert.direction === "below" && alert.currentPrice < alert.threshold);

  if (crossed) {
    return `${alert.symbol} at ${priceStr} — crossed ${alert.direction} ${threshStr} threshold!`;
  }
  return `${alert.symbol} at ${priceStr} — ${alert.distancePercent}% from ${threshStr} ${alert.direction} threshold`;
}
