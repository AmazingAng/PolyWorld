import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "https://api.minimaxi.com/anthropic",
  apiKey: "REDACTED_FALLBACK_API_KEY",
});

export interface MarketContext {
  title: string;
  prob: number | null;
  change: number | null;
  volume: number;
  volume24h: number;
  description: string | null;
  relatedTitles?: string[];
}

export interface CountryContext {
  country: string;
  markets: Array<{
    title: string;
    prob: number | null;
    change: number | null;
    volume24h: number;
  }>;
}

export async function generateMarketSummary(ctx: MarketContext): Promise<string> {
  const probStr = ctx.prob !== null ? `${(ctx.prob * 100).toFixed(1)}%` : "N/A";
  const changeStr = ctx.change !== null ? `${ctx.change > 0 ? "+" : ""}${(ctx.change * 100).toFixed(1)}%` : "N/A";
  const volStr = formatVol(ctx.volume);
  const vol24hStr = formatVol(ctx.volume24h);
  const related = ctx.relatedTitles?.length ? ctx.relatedTitles.join("; ") : "none";

  const prompt = `You are a prediction market analyst. Summarize this market in 2-3 concise sentences.
Market: ${ctx.title} | Prob: ${probStr} | 24h change: ${changeStr} | Volume: ${volStr} | 24h Vol: ${vol24hStr}
Description: ${ctx.description || "N/A"} | Related: ${related}
Focus on: what is predicted, current sentiment, notable movement. Be factual and concise.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return text.trim();
}

export async function generateCountrySummary(ctx: CountryContext): Promise<string> {
  const marketLines = ctx.markets
    .slice(0, 8)
    .map(
      (m) =>
        `- ${m.title} | ${m.prob !== null ? (m.prob * 100).toFixed(0) + "%" : "N/A"} | chg ${m.change !== null ? (m.change > 0 ? "+" : "") + (m.change * 100).toFixed(1) + "%" : "N/A"} | vol ${formatVol(m.volume24h)}`
    )
    .join("\n");

  const prompt = `You are a prediction market analyst. Summarize the prediction market activity for ${ctx.country} in 2-3 concise sentences.
Active markets:
${marketLines}
Focus on: dominant themes, overall sentiment, notable movements. Be factual and concise.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 250,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return text.trim();
}

function formatVol(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export async function matchNewsToMarkets(
  newsTitle: string,
  summary: string | null,
  markets: Array<{ id: string; title: string }>
): Promise<Array<{ marketId: string; score: number }>> {
  if (markets.length === 0) return [];

  const marketList = markets
    .slice(0, 20)
    .map((m, i) => `${i + 1}. [${m.id}] ${m.title}`)
    .join("\n");

  const prompt = `You are a news-market relevance analyst. Given a news headline and a list of prediction markets, return ONLY the markets that are relevant to the news.

News headline: ${newsTitle}
${summary ? `Summary: ${summary.slice(0, 300)}` : ""}

Markets:
${marketList}

Return a JSON array of objects with "marketId" and "score" (0-1). Only include markets with score >= 0.3.
Return [] if no markets are relevant. Return ONLY valid JSON, no other text.`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const parsed = JSON.parse(text.trim());
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item: { marketId?: string; score?: number }) =>
          typeof item.marketId === "string" && typeof item.score === "number"
      )
      .map((item: { marketId: string; score: number }) => ({
        marketId: item.marketId,
        score: Math.min(1, Math.max(0, item.score)),
      }));
  } catch {
    return [];
  }
}
