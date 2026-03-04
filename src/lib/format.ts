export function formatVolume(v: number): string {
  if (!v) return "$0";
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

export function formatPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export function formatChange(delta: number | null): {
  text: string;
  cls: "up" | "down" | "neutral";
} {
  if (delta === null || delta === undefined || isNaN(delta))
    return { text: "—", cls: "neutral" };
  const sign = delta >= 0 ? "+" : "";
  return {
    text: `${sign}${(delta * 100).toFixed(1)}%`,
    cls: delta > 0.001 ? "up" : delta < -0.001 ? "down" : "neutral",
  };
}
