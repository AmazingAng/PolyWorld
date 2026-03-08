"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { SentimentIndex } from "@/types";

function scoreColor(v: number): string {
  if (v < 20) return "#ef4444";
  if (v < 40) return "#f97316";
  if (v < 60) return "#eab308";
  if (v < 80) return "#22c55e";
  return "#10b981";
}

function Gauge({ score }: { score: number }) {
  const cx = 70;
  const cy = 66;
  const r = 52;
  const track = 6;
  const w = 140;
  const h = 78;

  // Helper: angle in radians for a 0-100 value on a 180° arc (π → 0)
  const valToAngle = (v: number) => Math.PI * (1 - v / 100);
  const polar = (angle: number, radius: number) => ({
    x: cx + radius * Math.cos(angle),
    y: cy - radius * Math.sin(angle),
  });

  // Gradient arc segments: 5 colored bands across the semicircle
  const bands: [number, number, string][] = [
    [0, 20, "#ef4444"],   // extreme fear — red
    [20, 40, "#f97316"],  // fear — orange
    [40, 60, "#eab308"],  // neutral — yellow
    [60, 80, "#22c55e"],  // greed — green
    [80, 100, "#10b981"], // extreme greed — teal
  ];

  const arcPath = (from: number, to: number) => {
    const a1 = valToAngle(from);
    const a2 = valToAngle(to);
    const p1 = polar(a1, r);
    const p2 = polar(a2, r);
    const large = Math.abs(a1 - a2) > Math.PI ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`;
  };

  // Needle
  const needleAngle = valToAngle(Math.max(0, Math.min(100, score)));
  const needleTip = polar(needleAngle, r - track / 2 - 1);
  const needleBase1 = polar(needleAngle + 0.12, 6);
  const needleBase2 = polar(needleAngle - 0.12, 6);
  const needlePath = `M ${needleTip.x} ${needleTip.y} L ${needleBase1.x} ${needleBase1.y} L ${needleBase2.x} ${needleBase2.y} Z`;

  // Tick marks at 0, 25, 50, 75, 100
  const ticks = [0, 25, 50, 75, 100];

  const color = scoreColor(score);

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} data-testid="sentiment-gauge">
      {/* Colored arc bands */}
      {bands.map(([from, to, c]) => (
        <path
          key={from}
          d={arcPath(from, to)}
          fill="none"
          stroke={c}
          strokeWidth={track}
          opacity={0.25}
        />
      ))}

      {/* Bright active portion up to score */}
      {bands.map(([from, to, c]) => {
        const clampedTo = Math.min(to, score);
        if (clampedTo <= from) return null;
        return (
          <path
            key={`active-${from}`}
            d={arcPath(from, clampedTo)}
            fill="none"
            stroke={c}
            strokeWidth={track}
          />
        );
      })}

      {/* Tick marks */}
      {ticks.map((t) => {
        const a = valToAngle(t);
        const p1 = polar(a, r + 4);
        const p2 = polar(a, r + 8);
        return (
          <line
            key={t}
            x1={p1.x} y1={p1.y}
            x2={p2.x} y2={p2.y}
            stroke="var(--text-ghost)"
            strokeWidth={1}
          />
        );
      })}

      {/* Needle */}
      <path d={needlePath} fill={color} />
      <circle cx={cx} cy={cy} r={3} fill={color} />

      {/* Score */}
      <text
        data-testid="gauge-score"
        x={cx}
        y={cy - 14}
        textAnchor="middle"
        fill={color}
        fontSize="22"
        fontFamily="monospace"
        fontWeight="bold"
      >
        {score}
      </text>

      {/* Endpoint labels */}
      <text x={cx - r - 2} y={cy + 10} textAnchor="middle" fill="var(--text-ghost)" fontSize="8" fontFamily="monospace">0</text>
      <text x={cx + r + 2} y={cy + 10} textAnchor="middle" fill="var(--text-ghost)" fontSize="8" fontFamily="monospace">100</text>
    </svg>
  );
}

function SubScoreBar({ name, value }: { name: string; value: number }) {
  const color = scoreColor(value);
  return (
    <div data-testid="subscore-row" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontFamily: "monospace" }}>
      <span style={{ color: "var(--text-muted)", width: 90, flexShrink: 0, textAlign: "right" }}>
        {name}
      </span>
      <div
        style={{
          flex: 1,
          height: 5,
          background: "var(--border)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${value}%`,
            height: "100%",
            background: color,
            borderRadius: 3,
            transition: "width 0.4s ease",
          }}
        />
      </div>
      <span style={{ color: "var(--text-dim)", width: 22, textAlign: "right" }}>{value}</span>
    </div>
  );
}

export default function SentimentPanel() {
  const [data, setData] = useState<SentimentIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const retryCount = useRef(0);

  const fetchSentiment = useCallback(async () => {
    try {
      const res = await fetch("/api/sentiment");
      if (!res.ok) throw new Error("fetch failed");
      const json: SentimentIndex = await res.json();
      setData(json);
      setError(null);
      retryCount.current = 0;
    } catch {
      if (retryCount.current < 3) {
        const delay = 2000 * Math.pow(2, retryCount.current);
        retryCount.current++;
        setTimeout(fetchSentiment, delay);
      } else {
        setError("加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSentiment();
    const iv = setInterval(fetchSentiment, 45_000);
    return () => clearInterval(iv);
  }, [fetchSentiment]);

  if (loading && !data) {
    return (
      <div style={{ padding: 12, fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>
        loading sentiment…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="text-[11px] text-[var(--red)] font-mono py-2 text-center">
        {error} <button onClick={() => { retryCount.current = 0; setLoading(true); fetchSentiment(); }} className="ml-2 underline">retry</button>
      </div>
    );
  }

  if (!data) return null;

  const color = scoreColor(data.score);

  return (
    <div data-testid="sentiment-panel" style={{ padding: "6px 10px", fontFamily: "monospace", display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Gauge + label */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
        <Gauge score={data.score} />
        <span data-testid="sentiment-label" style={{ fontSize: 11, fontWeight: 600, color, letterSpacing: 1, marginTop: -2 }}>
          {data.label.toUpperCase()}
        </span>
      </div>

      {/* Sub-score bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {data.subScores.map((s) => (
          <SubScoreBar key={s.name} name={s.name} value={s.value} />
        ))}
      </div>

      {/* Footer */}
      <div data-testid="sentiment-footer" style={{ fontSize: 9, color: "var(--text-ghost)", textAlign: "center" }}>
        {data.activeMarkets} active markets
      </div>
    </div>
  );
}
