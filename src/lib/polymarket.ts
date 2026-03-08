import { PolymarketEvent, ProcessedMarket } from "@/types";
import { detectCategory } from "./categories";

const API_BASE = "https://gamma-api.polymarket.com";

export async function fetchEventsFromAPI(): Promise<PolymarketEvent[]> {
  const events: PolymarketEvent[] = [];
  const seen = new Set<string>();
  const BATCH = 100;
  const CONCURRENCY = 5;

  // Fetch active events
  let offset = 0;
  let done = false;

  while (!done) {
    const offsets = Array.from({ length: CONCURRENCY }, (_, i) => offset + i * BATCH);
    const results = await Promise.all(
      offsets.map(async (off) => {
        const url = `${API_BASE}/events?active=true&closed=false&limit=${BATCH}&offset=${off}&order=volume24hr&ascending=false`;
        try {
          const res = await fetch(url, { next: { revalidate: 30 } });
          if (!res.ok) return [];
          return res.json();
        } catch {
          return [];
        }
      })
    );

    let pageHadData = false;
    for (const page of results) {
      const arr = Array.isArray(page)
        ? page
        : page?.data || page?.events || [];
      if (arr.length === 0) {
        done = true;
      } else {
        pageHadData = true;
        for (const e of arr) {
          if (e?.id && !seen.has(e.id)) {
            seen.add(e.id);
            events.push(e);
          }
        }
      }
    }

    if (!pageHadData) break;
    offset += CONCURRENCY * BATCH;
  }

  // Also fetch recently closed events (top 100 by volume) to update status
  try {
    const closedUrl = `${API_BASE}/events?closed=true&limit=200&offset=0&order=volume24hr&ascending=false`;
    const res = await fetch(closedUrl, { next: { revalidate: 60 } });
    if (res.ok) {
      const data = await res.json();
      const arr = Array.isArray(data) ? data : data?.data || data?.events || [];
      for (const e of arr) {
        if (e?.id && !seen.has(e.id)) {
          seen.add(e.id);
          events.push(e);
        }
      }
    }
  } catch {
    // Non-critical, skip
  }

  console.log(`[polymarket] Fetched ${events.length} events (active + recently closed)`);
  return events;
}

const previousPrices = new Map<string, number>();

export function processEvents(events: PolymarketEvent[]): {
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
} {
  const mapped: ProcessedMarket[] = [];
  const unmapped: ProcessedMarket[] = [];

  for (const event of events) {
    const vol = parseFloat(String(event.volume || event.volume_num || 0));
    if (vol < 500) continue;

    const category = detectCategory(event);

    const markets = event.markets || [];

    // Find the highest-probability sub-market (not just the first one)
    let primary = markets[0];
    let prob: number | null = null;
    for (const mk of markets) {
      try {
        const raw = mk.outcomePrices;
        if (!raw) continue;
        const p = Array.isArray(raw) ? raw : JSON.parse(raw as string);
        const val = parseFloat(p[0]);
        if (!isNaN(val) && (prob === null || val > prob)) {
          prob = val;
          primary = mk;
        }
      } catch {
        // Skip malformed outcomePrices
      }
    }

    // Fallback to event-level prices if no sub-market had valid prices
    if (prob === null) {
      try {
        const prices = (event as unknown as Record<string, unknown>).outcomePrices;
        if (prices) {
          const p = Array.isArray(prices) ? prices : JSON.parse(prices as string);
          prob = parseFloat(p[0]);
        }
      } catch {
        // Skip malformed outcomePrices
      }
    }

    const marketId = primary?.id || event.id;
    let change: number | null = null;
    if (primary?.oneDayPriceChange !== undefined) {
      change = parseFloat(String(primary.oneDayPriceChange));
    } else if (event.oneDayPriceChange !== undefined) {
      change = parseFloat(String(event.oneDayPriceChange));
    }

    let recentChange: number | null = null;
    if (prob !== null && previousPrices.has(marketId)) {
      recentChange = prob - previousPrices.get(marketId)!;
    }
    if (prob !== null) {
      previousPrices.set(marketId, prob);
    }

    const tagLabels = (event.tags || [])
      .map((t) => t.label || t.name || "")
      .filter(Boolean);

    const item: ProcessedMarket = {
      id: event.id,
      marketId,
      title: event.title || primary?.question || "Untitled",
      slug: event.slug || "",
      category,
      volume: vol,
      volume24h: parseFloat(
        String(event.volume_24hr || event.volume24hr || 0)
      ),
      prob,
      change,
      recentChange,
      markets,
      location: null,
      coords: null,
      description: event.description || null,
      resolutionSource: event.resolutionSource || null,
      endDate: event.endDate || null,
      image: event.image || null,
      liquidity: parseFloat(String(event.liquidity || 0)),
      active: event.active !== false,
      closed: event.closed === true || (markets.length > 0 && markets.every((mk) => mk.closed === true || mk.active === false)),
      commentCount: event.commentCount || 0,
      tags: tagLabels,
      createdAt: event.startDate || event.createdAt || null,
      impactScore: 0,
      impactLevel: "info",
    };

    unmapped.push(item);
  }

  return { mapped, unmapped };
}

export function getSampleData(): PolymarketEvent[] {
  return [
    { id: "s1", title: "Will Trump win the 2028 presidential election?", slug: "will-trump-win-2028", description: "This market will resolve to \"Yes\" if Donald Trump wins the 2028 United States presidential election. The resolution source will be the Associated Press call.", markets: [{ id: "m1", question: "Trump wins 2028?", outcomePrices: ["0.35", "0.65"], outcomes: ["Yes", "No"] }], volume: 15000000, volume_24hr: 890000, endDate: "2028-11-05T00:00:00Z", liquidity: 2500000 },
    { id: "s2", title: "Will Russia and Ukraine reach a ceasefire by 2026?", slug: "russia-ukraine-ceasefire", description: "Russia Ukraine war ceasefire agreement", markets: [{ id: "m2", question: "Ceasefire by 2026?", outcomePrices: ["0.22", "0.78"], outcomes: ["Yes", "No"] }], volume: 8500000, volume_24hr: 420000 },
    { id: "s3", title: "Will Bitcoin reach $150,000 in 2026?", slug: "bitcoin-150k", description: "Bitcoin crypto price prediction", markets: [{ id: "m3", question: "BTC > $150K?", outcomePrices: ["0.28", "0.72"], outcomes: ["Yes", "No"] }], volume: 12000000, volume_24hr: 650000 },
    { id: "s4", title: "Will China invade Taiwan by 2027?", slug: "china-taiwan-invasion", description: "China Taiwan military conflict", markets: [{ id: "m4", question: "China invades Taiwan?", outcomePrices: ["0.06", "0.94"], outcomes: ["Yes", "No"] }], volume: 5200000, volume_24hr: 180000 },
    { id: "s5", title: "Will Israel and Hamas reach a permanent ceasefire?", slug: "israel-hamas-ceasefire", description: "Israel Hamas Gaza ceasefire deal", markets: [{ id: "m5", question: "Permanent ceasefire?", outcomePrices: ["0.31", "0.69"], outcomes: ["Yes", "No"] }], volume: 6800000, volume_24hr: 310000 },
    { id: "s6", title: "Will the Federal Reserve cut rates in March 2026?", slug: "fed-rate-cut-march", description: "US Federal Reserve interest rate decision", markets: [{ id: "m6", question: "Rate cut in March?", outcomePrices: ["0.42", "0.58"], outcomes: ["Yes", "No"] }], volume: 9200000, volume_24hr: 520000 },
    { id: "s7", title: "Will Macron resign before 2027?", slug: "macron-resign", description: "French president Macron resignation", markets: [{ id: "m7", question: "Macron resigns?", outcomePrices: ["0.08", "0.92"], outcomes: ["Yes", "No"] }], volume: 2100000, volume_24hr: 95000 },
    { id: "s8", title: "Will North Korea conduct a nuclear test in 2026?", slug: "north-korea-nuke-test", description: "North Korea Kim Jong Un nuclear weapons test", markets: [{ id: "m8", question: "Nuclear test in 2026?", outcomePrices: ["0.12", "0.88"], outcomes: ["Yes", "No"] }], volume: 3400000, volume_24hr: 140000 },
    { id: "s9", title: "Will India GDP growth exceed 7% in 2026?", slug: "india-gdp-2026", description: "India economic growth GDP Modi", markets: [{ id: "m9", question: "GDP > 7%?", outcomePrices: ["0.55", "0.45"], outcomes: ["Yes", "No"] }], volume: 1800000, volume_24hr: 72000 },
    { id: "s10", title: "Will Milei be re-elected in Argentina?", slug: "milei-reelection", description: "Argentina president Milei election", markets: [{ id: "m10", question: "Milei re-elected?", outcomePrices: ["0.48", "0.52"], outcomes: ["Yes", "No"] }], volume: 1500000, volume_24hr: 65000 },
    { id: "s11", title: "Will there be a US-China trade deal in 2026?", slug: "us-china-trade", description: "US China trade tariff deal negotiations", markets: [{ id: "m11", question: "Trade deal in 2026?", outcomePrices: ["0.18", "0.82"], outcomes: ["Yes", "No"] }], volume: 7200000, volume_24hr: 380000 },
    { id: "s12", title: "Will Turkey leave NATO?", slug: "turkey-leave-nato", description: "Turkey NATO membership Erdogan", markets: [{ id: "m12", question: "Turkey exits NATO?", outcomePrices: ["0.03", "0.97"], outcomes: ["Yes", "No"] }], volume: 980000, volume_24hr: 34000 },
    { id: "s13", title: "Will Starmer call a snap election in 2026?", slug: "starmer-snap-election", description: "UK British prime minister Starmer election", markets: [{ id: "m13", question: "Snap election?", outcomePrices: ["0.07", "0.93"], outcomes: ["Yes", "No"] }], volume: 1100000, volume_24hr: 42000 },
    { id: "s14", title: "Will Iran develop a nuclear weapon by 2027?", slug: "iran-nuclear-weapon", description: "Iran nuclear program weapons", markets: [{ id: "m14", question: "Iran nuclear weapon?", outcomePrices: ["0.15", "0.85"], outcomes: ["Yes", "No"] }], volume: 4100000, volume_24hr: 190000 },
    { id: "s15", title: "Will the EU impose new sanctions on Russia in 2026?", slug: "eu-russia-sanctions", description: "European Union Russia sanctions", markets: [{ id: "m15", question: "New EU sanctions?", outcomePrices: ["0.72", "0.28"], outcomes: ["Yes", "No"] }], volume: 2900000, volume_24hr: 110000 },
    { id: "s16", title: "Will Ethereum reach $10,000?", slug: "eth-10k", description: "Ethereum crypto price", markets: [{ id: "m16", question: "ETH > $10K?", outcomePrices: ["0.12", "0.88"], outcomes: ["Yes", "No"] }], volume: 5600000, volume_24hr: 280000 },
    { id: "s17", title: "Will Canada elect a Conservative government?", slug: "canada-conservative", description: "Canada Canadian election Poilievre Carney", markets: [{ id: "m17", question: "Conservative win?", outcomePrices: ["0.62", "0.38"], outcomes: ["Yes", "No"] }], volume: 3200000, volume_24hr: 150000 },
    { id: "s18", title: "Will Saudi Arabia normalize relations with Israel?", slug: "saudi-israel", description: "Saudi Arabia Israel normalization Abraham Accords", markets: [{ id: "m18", question: "Normalization deal?", outcomePrices: ["0.25", "0.75"], outcomes: ["Yes", "No"] }], volume: 2400000, volume_24hr: 88000 },
    { id: "s19", title: "Will OpenAI release GPT-5 before July 2026?", slug: "gpt5-release", description: "OpenAI GPT-5 AI artificial intelligence", markets: [{ id: "m19", question: "GPT-5 by July?", outcomePrices: ["0.58", "0.42"], outcomes: ["Yes", "No"] }], volume: 4800000, volume_24hr: 250000 },
    { id: "s20", title: "Will South Korea hold early elections in 2026?", slug: "south-korea-election", description: "South Korea Korean election", markets: [{ id: "m20", question: "Early elections?", outcomePrices: ["0.65", "0.35"], outcomes: ["Yes", "No"] }], volume: 1900000, volume_24hr: 78000 },
    { id: "s21", title: "Will Zelensky remain president of Ukraine through 2026?", slug: "zelensky-president", description: "Ukraine Zelensky presidency", markets: [{ id: "m21", question: "Zelensky stays?", outcomePrices: ["0.71", "0.29"], outcomes: ["Yes", "No"] }], volume: 2800000, volume_24hr: 130000 },
    { id: "s22", title: "Will Japan raise interest rates again in 2026?", slug: "japan-rates", description: "Japan Bank of Japan interest rate monetary policy", markets: [{ id: "m22", question: "BOJ rate hike?", outcomePrices: ["0.68", "0.32"], outcomes: ["Yes", "No"] }], volume: 3100000, volume_24hr: 160000 },
    { id: "s23", title: "Will Germany hold snap elections?", slug: "germany-snap-election", description: "Germany Scholz election coalition", markets: [{ id: "m23", question: "Snap election?", outcomePrices: ["0.45", "0.55"], outcomes: ["Yes", "No"] }], volume: 1600000, volume_24hr: 55000 },
    { id: "s24", title: "Will there be a new conflict in the South China Sea?", slug: "south-china-sea", description: "China Philippines South China Sea conflict military", markets: [{ id: "m24", question: "SCS conflict?", outcomePrices: ["0.19", "0.81"], outcomes: ["Yes", "No"] }], volume: 2200000, volume_24hr: 92000 },
  ];
}
