import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { SentimentIndex, SentimentSubScore } from "@/types";

export const dynamic = "force-dynamic";

// 30s in-memory cache
let cached: { data: SentimentIndex; fetchedAt: number } | null = null;
const CACHE_TTL = 30_000;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function getLabel(score: number): string {
  if (score < 20) return "Extreme Fear";
  if (score < 40) return "Fear";
  if (score < 60) return "Neutral";
  if (score < 80) return "Greed";
  return "Extreme Greed";
}

function computeSentiment(): SentimentIndex {
  const db = getDb();

  // --- 1. Price Momentum (25%) ---
  const events = db
    .prepare(
      `SELECT change, volume_24h FROM events WHERE is_active=1 AND is_closed=0 AND change IS NOT NULL`
    )
    .all() as { change: number; volume_24h: number }[];

  let priceMomentum = 50;
  if (events.length > 0) {
    let sumWC = 0;
    let sumV = 0;
    for (const e of events) {
      const v = e.volume_24h || 0;
      sumWC += e.change * v;
      sumV += v;
    }
    const weightedChange = sumV > 0 ? sumWC / sumV : 0;
    priceMomentum = 50 + 50 * Math.tanh(weightedChange * 10);
  }

  // --- 2. Volume (20%) ---
  const currentVolRow = db
    .prepare(
      `SELECT SUM(volume_24h) as total FROM events WHERE is_active=1 AND is_closed=0`
    )
    .get() as { total: number | null } | undefined;
  const currentVol = currentVolRow?.total || 0;

  const histVolRow = db
    .prepare(
      `SELECT AVG(daily) as avg FROM (SELECT DATE(recorded_at) d, SUM(volume_24h) daily FROM price_snapshots WHERE recorded_at > datetime('now','-7 days') AND recorded_at < datetime('now','-1 day') GROUP BY d)`
    )
    .get() as { avg: number | null } | undefined;
  const histVol = histVolRow?.avg || 0;

  let volumeScore = 50;
  if (histVol > 0) {
    const ratio = currentVol / histVol;
    volumeScore = 50 + 50 * Math.tanh((ratio - 1) * 1.5);
  }

  // --- 3. Smart Money (25%) ---
  const trades = db
    .prepare(
      `SELECT side, usdc_size, is_smart_wallet FROM whale_trades WHERE timestamp > datetime('now','-24 hours')`
    )
    .all() as { side: string; usdc_size: number; is_smart_wallet: number }[];

  let smartMoneyScore = 50;
  if (trades.length > 0) {
    let buyVol = 0;
    let sellVol = 0;
    for (const t of trades) {
      const weight = t.is_smart_wallet ? 1.5 : 1;
      const size = (t.usdc_size || 0) * weight;
      if (t.side === "BUY") buyVol += size;
      else sellVol += size;
    }
    const total = buyVol + sellVol;
    smartMoneyScore = total > 0 ? (buyVol / total) * 100 : 50;
  }

  // --- 4. Volatility (15%) — inverted ---
  let volatilityScore = 50;
  if (events.length > 0) {
    let sumAbs = 0;
    for (const e of events) sumAbs += Math.abs(e.change);
    const avgAbsChange = sumAbs / events.length;
    volatilityScore = 100 - clamp(avgAbsChange * 500, 0, 100);
  }

  // --- 5. Market Breadth (15%) ---
  let breadthScore = 50;
  if (events.length > 0) {
    let up = 0;
    let down = 0;
    for (const e of events) {
      if (e.change > 0.001) up++;
      else if (e.change < -0.001) down++;
    }
    const total = up + down;
    breadthScore = total > 0 ? (up / total) * 100 : 50;
  }

  const subScores: SentimentSubScore[] = [
    { name: "Price Momentum", value: Math.round(priceMomentum), weight: 0.25 },
    { name: "Volume", value: Math.round(volumeScore), weight: 0.2 },
    { name: "Smart Money", value: Math.round(smartMoneyScore), weight: 0.25 },
    { name: "Volatility", value: Math.round(volatilityScore), weight: 0.15 },
    { name: "Market Breadth", value: Math.round(breadthScore), weight: 0.15 },
  ];

  const composite = subScores.reduce((sum, s) => sum + s.value * s.weight, 0);
  const score = Math.round(composite);

  return {
    score,
    label: getLabel(score),
    subScores,
    activeMarkets: events.length,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    const data = computeSentiment();
    cached = { data, fetchedAt: Date.now() };
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/sentiment] Error:", err);
    return NextResponse.json(
      {
        score: 50,
        label: "Neutral",
        subScores: [],
        activeMarkets: 0,
        updatedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
