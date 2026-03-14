import type { ProcessedMarket } from "@/types";
import { extractKeywords } from "./keywords";

interface SimilarMarketResult {
  market: ProcessedMarket;
  similarity: number;
  reason: string;
}

/**
 * Find the most similar markets to a target using a weighted composite score:
 * - Tag Jaccard similarity (weight 0.4)
 * - Category match (weight 0.3)
 * - Title keyword overlap (weight 0.3)
 */
export function findSimilarMarkets(
  target: ProcessedMarket,
  allMarkets: ProcessedMarket[],
  topN = 5,
): SimilarMarketResult[] {
  const targetTags = new Set(target.tags.map((t) => t.toLowerCase()));
  const targetKeywords = new Set(extractKeywords(target.title));

  const scored: SimilarMarketResult[] = [];

  for (const m of allMarkets) {
    if (m.id === target.id) continue;

    // 1. Tag Jaccard similarity (weight 0.4)
    const mTags = new Set(m.tags.map((t) => t.toLowerCase()));
    let tagScore = 0;
    if (targetTags.size > 0 || mTags.size > 0) {
      let intersection = 0;
      for (const t of targetTags) {
        if (mTags.has(t)) intersection++;
      }
      const union = targetTags.size + mTags.size - intersection;
      tagScore = union > 0 ? intersection / union : 0;
    }

    // 2. Category match (weight 0.3)
    const categoryScore = m.category === target.category ? 1.0 : 0;

    // 3. Title keyword overlap (weight 0.3)
    const mKeywords = new Set(extractKeywords(m.title));
    let keywordScore = 0;
    if (targetKeywords.size > 0 || mKeywords.size > 0) {
      let intersection = 0;
      for (const k of targetKeywords) {
        if (mKeywords.has(k)) intersection++;
      }
      const union = targetKeywords.size + mKeywords.size - intersection;
      keywordScore = union > 0 ? intersection / union : 0;
    }

    const similarity = tagScore * 0.4 + categoryScore * 0.3 + keywordScore * 0.3;

    if (similarity > 0.05) {
      // Build reason string from the dominant factor
      const reasons: string[] = [];
      if (tagScore > 0) reasons.push("shared tags");
      if (categoryScore > 0) reasons.push("same category");
      if (keywordScore > 0) reasons.push("similar title");
      const reason = reasons.join(", ");

      scored.push({ market: m, similarity, reason });
    }
  }

  return scored
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN);
}
