import type { ProcessedMarket } from "@/types";

export type ImpactLevel = "critical" | "high" | "medium" | "low" | "info";

export const IMPACT_LEVELS: { level: ImpactLevel; min: number; label: string }[] = [
  { level: "critical", min: 80, label: "Critical" },
  { level: "high", min: 60, label: "High" },
  { level: "medium", min: 35, label: "Medium" },
  { level: "low", min: 15, label: "Low" },
  { level: "info", min: 0, label: "Info" },
];

export const IMPACT_COLORS: Record<ImpactLevel, string> = {
  critical: "#ff4444",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#6b7280",
  info: "#4b5563",
};

function getLevel(score: number): ImpactLevel {
  for (const l of IMPACT_LEVELS) {
    if (score >= l.min) return l.level;
  }
  return "info";
}

/** Compute percentile ranks for an array of numbers (0-1) */
function percentileRanks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    // Find rank using bisect
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return sorted.length > 1 ? lo / (sorted.length - 1) : 0.5;
  });
}

/**
 * Compute impact scores (0-100) for all markets.
 * Formula (weighted percentile):
 *   volumeScore    = percentile(log1p(volume24h)) * 35
 *   changeScore    = percentile(abs(change))      * 25
 *   liquidityScore = percentile(log1p(liquidity))  * 15
 *   commentScore   = percentile(log1p(comments))   * 10
 *   recencyScore   = age-based (max 15)
 */
export function computeImpactScores(
  markets: ProcessedMarket[]
): Map<string, { impactScore: number; impactLevel: ImpactLevel }> {
  const result = new Map<string, { impactScore: number; impactLevel: ImpactLevel }>();
  if (markets.length === 0) return result;

  const volumeVals = markets.map((m) => Math.log1p(m.volume24h || 0));
  const changeVals = markets.map((m) => Math.abs(m.change ?? 0));
  const liquidityVals = markets.map((m) => Math.log1p(m.liquidity || 0));
  const commentVals = markets.map((m) => Math.log1p(m.commentCount || 0));

  const volumeRanks = percentileRanks(volumeVals);
  const changeRanks = percentileRanks(changeVals);
  const liquidityRanks = percentileRanks(liquidityVals);
  const commentRanks = percentileRanks(commentVals);

  const now = Date.now();

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];

    // Recency score based on age
    let recencyScore = 0;
    if (m.createdAt) {
      const ageMs = now - new Date(m.createdAt).getTime();
      const ageH = ageMs / (1000 * 60 * 60);
      if (ageH < 6) recencyScore = 15;
      else if (ageH < 24) recencyScore = 10;
      else if (ageH < 48) recencyScore = 5;
    }

    const score =
      volumeRanks[i] * 35 +
      changeRanks[i] * 25 +
      liquidityRanks[i] * 15 +
      commentRanks[i] * 10 +
      recencyScore;

    const clamped = Math.round(Math.max(0, Math.min(100, score)));
    result.set(m.id, { impactScore: clamped, impactLevel: getLevel(clamped) });
  }

  return result;
}
