export const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "as", "be", "was", "are",
  "been", "has", "had", "have", "will", "can", "may", "not", "this",
  "that", "its", "his", "her", "their", "our", "your", "all", "more",
  "new", "out", "up", "one", "two", "also", "into", "over", "after",
  "than", "about", "says", "said", "would", "could", "should", "who",
  "what", "when", "where", "how", "which", "just", "some", "other",
  "most", "them", "these", "then", "so", "no", "yes", "he", "she",
  "they", "we", "you", "me", "him", "us", "my", "do", "did", "does",
  "if", "each", "get", "got", "go", "been", "being", "make", "made",
  "very", "much", "many", "any", "own", "such", "like", "even", "still",
  "between", "through", "during", "before", "under", "against", "both",
  // High-frequency words that cause false matches across domains
  "market", "markets", "price", "prices", "win", "winner", "won",
  "will", "year", "day", "time", "first", "last", "next", "end",
  "top", "best", "back", "take", "come", "world", "hit", "set",
  "per", "report", "reports", "according", "people", "says",
  "could", "may", "might", "week", "month", "state", "states",
  "news", "update", "latest", "today", "yesterday", "number",
]);

export const MIN_KEYWORD_LENGTH = 4;

export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(w));
}
