"use client";

import { useEffect, useState, useId, useMemo, useRef, useCallback } from "react";

interface SnapshotRow {
  prob: number;
  volume_24h: number;
  change: number;
  recorded_at: string;
}

interface SeriesData {
  marketId: string;
  label: string;
  data: { prob: number; recorded_at: string }[];
}

interface SparklineProps {
  eventId: string;
  hours?: number;
  width?: number;
  height?: number;
  /** If true, fetch per-market series for multi-line chart */
  multiSeries?: boolean;
}

import { SERIES_COLORS } from "@/lib/chartConstants";

// In-memory cache for sparkline API responses (survives re-mounts within same session)
const sparklineCache = new Map<string, { ts: number; single: SnapshotRow[]; multi: SeriesData[] }>();
const CACHE_TTL_MS = 60_000; // 1 minute

/** Largest-Triangle-Three-Buckets downsampling */
function lttb(data: { t: number; v: number }[], target: number): { t: number; v: number }[] {
  if (data.length <= target) return data;

  const out: { t: number; v: number }[] = [data[0]];
  const bucketSize = (data.length - 2) / (target - 2);

  let prevIdx = 0;

  for (let i = 1; i < target - 1; i++) {
    const bucketStart = Math.floor((i - 1) * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor(i * bucketSize) + 1, data.length - 1);
    const nextBucketStart = Math.min(Math.floor((i + 1 - 1) * bucketSize) + 1, data.length - 1);
    const nextBucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length - 1);

    let avgT = 0, avgV = 0, cnt = 0;
    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      avgT += data[j].t;
      avgV += data[j].v;
      cnt++;
    }
    if (cnt > 0) { avgT /= cnt; avgV /= cnt; }

    let maxArea = -1;
    let bestIdx = bucketStart;
    const prev = data[prevIdx];

    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs(
        (prev.t - avgT) * (data[j].v - prev.v) -
        (prev.t - data[j].t) * (avgV - prev.v)
      );
      if (area > maxArea) {
        maxArea = area;
        bestIdx = j;
      }
    }

    out.push(data[bestIdx]);
    prevIdx = bestIdx;
  }

  out.push(data[data.length - 1]);
  return out;
}

interface ProcessedSeries {
  label: string;
  color: string;
  sampled: { t: number; v: number }[];
  coords: { x: number; y: number }[];
  pathPoints: string;
  lastValue: number;
}

export default function Sparkline({
  eventId,
  hours = 24,
  width = 120,
  height = 40,
  multiSeries = false,
}: SparklineProps) {
  const sparklineKey = `${eventId}:${hours}:${width}:${height}:${multiSeries ? "multi" : "single"}`;
  return (
    <SparklineContent
      key={sparklineKey}
      eventId={eventId}
      hours={hours}
      width={width}
      height={height}
      multiSeries={multiSeries}
    />
  );
}

function SparklineContent({
  eventId,
  hours = 24,
  width = 120,
  height = 40,
  multiSeries = false,
}: SparklineProps) {
  const [singleData, setSingleData] = useState<SnapshotRow[]>([]);
  const [multiData, setMultiData] = useState<SeriesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${eventId}:${hours}:${multiSeries ? "m" : "s"}`;

    // Check cache first
    const cached = sparklineCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setSingleData(cached.single);
      setMultiData(cached.multi);
      setLoading(false);
      return;
    }

    const baseUrl = `/api/snapshots?eventId=${encodeURIComponent(eventId)}&hours=${hours}`;

    const fetchPerMarket = multiSeries
      ? fetch(`${baseUrl}&perMarket=1`).then(r => r.json()).then(result => {
          const series: SeriesData[] = (result?.series || []).filter((s: SeriesData) => s.data.length >= 2);
          return series.length > 0 ? series : null;
        }).catch(() => null)
      : Promise.resolve(null);

    fetchPerMarket.then((series) => {
      if (cancelled) return;
      if (series) {
        setMultiData(series);
        setSingleData([]);
        sparklineCache.set(cacheKey, { ts: Date.now(), single: [], multi: series });
        setLoading(false);
        return;
      }
      // Fall back to event-level snapshots
      return fetch(baseUrl).then(r => r.json()).then((rows) => {
        if (cancelled) return;
        const filtered = Array.isArray(rows) ? rows.filter((r: SnapshotRow) => r.prob != null && !isNaN(r.prob)) : [];
        setSingleData(filtered);
        setMultiData([]);
        sparklineCache.set(cacheKey, { ts: Date.now(), single: filtered, multi: [] });
        setLoading(false);
      });
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [eventId, hours, multiSeries]);

  // Chart layout constants
  const showAxes = height >= 60;
  const leftPad = showAxes ? 36 : 2;
  const hasMultiData = multiData.length > 0;
  const hasSingleData = singleData.length >= 2;
  const [renderNow] = useState(() => Date.now());
  const rightPad = showAxes ? (hasMultiData ? 65 : (hasSingleData ? 35 : 6)) : 6;
  const topPad = 6;
  const bottomPad = showAxes ? 18 : 6;
  const chartW = width - leftPad - rightPad;
  const chartH = height - topPad - bottomPad;

  const tMin = renderNow - hours * 3600_000;
  const tMax = renderNow;
  const tRange = tMax - tMin;

  // Process multi-series data
  const processedMulti = useMemo((): ProcessedSeries[] | null => {
    if (multiData.length === 0) return null;

    // Sort series by latest value descending for color assignment (top series = most visible color)
    const withLatest = multiData.map((s, i) => {
      const pts = s.data.map(d => ({ t: new Date(d.recorded_at).getTime(), v: d.prob }));
      return { ...s, pts, lastValue: pts[pts.length - 1]?.v ?? 0, origIdx: i };
    }).sort((a, b) => b.lastValue - a.lastValue);

    // Global Y range across all series (0 to max for probability charts)
    const vMin = 0;
    let vMax = Math.max(...withLatest.map(s => Math.max(...s.pts.map(p => p.v))));
    if (vMax <= 0) vMax = 1;
    // Add a bit of top padding
    vMax = Math.min(1, vMax * 1.05);
    const vRange = vMax - vMin || 0.01;

    return withLatest.map((s, colorIdx) => {
      const sampled = lttb(s.pts, Math.min(150, s.pts.length));
      const coords = sampled.map(p => ({
        x: leftPad + ((p.t - tMin) / tRange) * chartW,
        y: topPad + (1 - (p.v - vMin) / vRange) * chartH,
      }));
      const pathPoints = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
      return {
        label: s.label,
        color: SERIES_COLORS[colorIdx % SERIES_COLORS.length],
        sampled,
        coords,
        pathPoints,
        lastValue: s.lastValue,
      };
    });
  }, [multiData, leftPad, topPad, chartW, chartH, tMin, tRange]);

  // Process single-series data (fallback)
  const processedSingle = useMemo(() => {
    if (singleData.length < 2) return null;

    const withTime = singleData.map(d => ({ t: new Date(d.recorded_at).getTime(), v: d.prob }));
    const sampled = lttb(withTime, Math.min(150, withTime.length));

    const vMin = Math.min(...sampled.map(s => s.v));
    const vMax = Math.max(...sampled.map(s => s.v));
    const vRange = vMax - vMin || 0.01;

    return { sampled, vMin, vMax, vRange };
  }, [singleData]);

  // Hover tooltip data
  const hoverInfo = useMemo(() => {
    if (hoverX === null) return null;
    // Convert pixel X to timestamp
    const t = tMin + ((hoverX - leftPad) / chartW) * tRange;
    if (t < tMin || t > tMax) return null;

    if (processedMulti) {
      // Find nearest value for each series at this time
      const items = processedMulti.map(s => {
        // Binary search for nearest point
        let best = s.sampled[0];
        let bestDist = Math.abs(best.t - t);
        for (const p of s.sampled) {
          const d = Math.abs(p.t - t);
          if (d < bestDist) { best = p; bestDist = d; }
        }
        return { label: s.label, color: s.color, value: best.v };
      }).sort((a, b) => b.value - a.value);

      const d = new Date(t);
      const timeStr = hours > 48
        ? `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`
        : `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;

      return { items, timeStr, x: hoverX };
    }

    if (processedSingle) {
      let best = processedSingle.sampled[0];
      let bestDist = Math.abs(best.t - t);
      for (const p of processedSingle.sampled) {
        const d = Math.abs(p.t - t);
        if (d < bestDist) { best = p; bestDist = d; }
      }
      const d = new Date(t);
      const timeStr = hours > 48
        ? `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`
        : `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
      return {
        items: [{ label: "Price", color: best.v >= processedSingle.sampled[0].v ? "#22c55e" : "#ff4444", value: best.v }],
        timeStr,
        x: hoverX,
      };
    }

    return null;
  }, [hoverX, processedMulti, processedSingle, leftPad, chartW, tMin, tMax, tRange, hours]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x >= leftPad && x <= width - rightPad) {
      setHoverX(x);
    } else {
      setHoverX(null);
    }
  }, [leftPad, width, rightPad]);

  const handleMouseLeave = useCallback(() => setHoverX(null), []);

  if (loading) {
    return (
      <div className="flex items-center justify-center animate-pulse" style={{ width, height }}>
        <div className="w-full h-full bg-[#1a1a1a] rounded-sm" />
      </div>
    );
  }

  const hasMulti = processedMulti && processedMulti.length > 0;
  const hasSingle = processedSingle !== null;

  if (!hasMulti && !hasSingle) {
    return (
      <div className="flex items-center justify-center text-[13px] text-[#8a8a8a] font-mono" style={{ width, height }}>
        no data
      </div>
    );
  }

  // Y-axis labels
  let yLabels: { val: number; y: number }[] = [];
  if (showAxes) {
    if (hasMulti) {
      // For multi-series, show 0% to vMax
      const vMax = Math.max(...processedMulti!.map(s => Math.max(...s.sampled.map(p => p.v))));
      const displayMax = Math.min(1, vMax * 1.05);
      yLabels = [
        { val: displayMax, y: topPad },
        { val: displayMax / 2, y: topPad + chartH / 2 },
        { val: 0, y: topPad + chartH },
      ];
    } else {
      const { vMin, vMax } = processedSingle!;
      yLabels = [
        { val: vMax, y: topPad },
        { val: (vMax + vMin) / 2, y: topPad + chartH / 2 },
        { val: vMin, y: topPad + chartH },
      ];
    }
  }

  // X-axis labels
  const xLabels: { text: string; x: number }[] = [];
  if (showAxes) {
    const fmt = (ms: number) => {
      const d = new Date(ms);
      const hh = d.getHours().toString().padStart(2, "0");
      const mm = d.getMinutes().toString().padStart(2, "0");
      const dd = d.getDate().toString().padStart(2, "0");
      const mo = (d.getMonth() + 1).toString().padStart(2, "0");
      if (hours > 48) {
        return `${mo}/${dd}`;
      }
      // For <=48h, include date if tMin and tMax are on different days, or always show M/D + HH:MM to avoid identical labels
      return `${mo}/${dd} ${hh}:${mm}`;
    };
    xLabels.push({ text: fmt(tMin), x: leftPad });
    xLabels.push({ text: fmt(tMax), x: width - rightPad });
  }

  // Tooltip position clamping
  const tooltipWidth = 130;
  let tooltipX = hoverInfo ? hoverInfo.x + 10 : 0;
  if (tooltipX + tooltipWidth > width) tooltipX = hoverInfo ? hoverInfo.x - tooltipWidth - 10 : 0;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: hoverX !== null ? "crosshair" : undefined }}
    >
      <defs>
        <filter id={`glow-${uid}`}>
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Grid lines */}
      {showAxes && yLabels.map((l, i) => (
        <line key={i} x1={leftPad} y1={l.y} x2={width - rightPad} y2={l.y}
          stroke="#2a2a2a" strokeWidth="0.5" strokeDasharray={i === 1 ? "3,3" : "none"} />
      ))}

      {/* Y-axis labels */}
      {yLabels.map((l, i) => (
        <text key={i} x={leftPad - 5} y={l.y + 3.5} textAnchor="end" fill="#8a8a8a" fontSize="10" fontFamily="monospace">
          {(l.val * 100).toFixed(0)}%
        </text>
      ))}

      {/* X-axis labels */}
      {xLabels.map((l, i) => (
        <text key={i} x={l.x} y={height - 3} textAnchor={i === 0 ? "start" : "end"} fill="#8a8a8a" fontSize="10" fontFamily="monospace">
          {l.text}
        </text>
      ))}

      {/* ===== Multi-series rendering ===== */}
      {hasMulti && processedMulti!.map((s, i) => (
        <g key={i}>
          {/* Line */}
          <polyline
            points={s.pathPoints}
            fill="none"
            stroke={s.color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={hoverX !== null ? 0.6 : 0.85}
          />
          {/* Endpoint dot */}
          {s.coords.length > 0 && (
            <circle
              cx={s.coords[s.coords.length - 1].x}
              cy={s.coords[s.coords.length - 1].y}
              r="2"
              fill={s.color}
            />
          )}
        </g>
      ))}

      {/* Multi-series labels at right edge */}
      {hasMulti && showAxes && (() => {
        const labelH = 11;
        const maxLabels = 6;
        const labels = processedMulti!.slice(0, maxLabels).map(s => {
          const last = s.coords[s.coords.length - 1];
          return { label: s.label, color: s.color, lastValue: s.lastValue, y: last?.y ?? 0, x: last?.x ?? 0 };
        }).sort((a, b) => a.y - b.y);
        // Spread overlapping labels
        for (let i = 1; i < labels.length; i++) {
          if (labels[i].y - labels[i - 1].y < labelH) {
            labels[i].y = labels[i - 1].y + labelH;
          }
        }
        // Clamp within chart area
        for (const l of labels) {
          l.y = Math.max(topPad + 4, Math.min(topPad + chartH - 2, l.y));
        }
        return labels.map((l, i) => {
          const disp = l.label.length > 5 ? l.label.slice(0, 4) + "\u2026" : l.label;
          return (
            <text key={i} x={l.x + 5} y={l.y + 3.5} fill={l.color} fontSize="9" fontFamily="monospace" opacity="0.9">
              {disp} {(l.lastValue * 100).toFixed(0)}%
            </text>
          );
        });
      })()}

      {/* ===== Single-series rendering ===== */}
      {hasSingle && !hasMulti && (() => {
        const { sampled, vMin, vRange } = processedSingle!;
        const coords = sampled.map(s => ({
          x: leftPad + ((s.t - tMin) / tRange) * chartW,
          y: topPad + (1 - (s.v - vMin) / vRange) * chartH,
        }));
        const pathPoints = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`);
        const wentUp = sampled[sampled.length - 1].v >= sampled[0].v;
        const color = wentUp ? "#22c55e" : "#ff4444";
        const lastPt = coords[coords.length - 1];

        return (
          <g>
            <polyline points={pathPoints.join(" ")} fill="none" stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={lastPt.x} cy={lastPt.y} r="2" fill={color} />
            {showAxes && (
              <text x={lastPt.x + 5} y={lastPt.y + 3.5} fill={color} fontSize="9" fontFamily="monospace" fontWeight="bold">
                {(sampled[sampled.length - 1].v * 100).toFixed(1)}%
              </text>
            )}
          </g>
        );
      })()}

      {/* ===== Hover crosshair + tooltip ===== */}
      {hoverInfo && (
        <g>
          {/* Vertical crosshair line */}
          <line
            x1={hoverInfo.x} y1={topPad}
            x2={hoverInfo.x} y2={topPad + chartH}
            stroke="#555" strokeWidth="0.5" strokeDasharray="3,2"
          />

          {/* Dots on each line at hover position (top 8 only) */}
          {hoverInfo.items.slice(0, 8).map((item, i) => {
            let y: number;
            if (hasMulti) {
              const vMax = Math.max(...processedMulti!.map(s => Math.max(...s.sampled.map(p => p.v))));
              const displayMax = Math.min(1, vMax * 1.05);
              y = topPad + (1 - item.value / displayMax) * chartH;
            } else {
              const { vMin, vRange } = processedSingle!;
              y = topPad + (1 - (item.value - vMin) / vRange) * chartH;
            }
            return (
              <circle key={i} cx={hoverInfo.x} cy={y} r="3" fill={item.color} stroke="#0a0a0a" strokeWidth="0.8" />
            );
          })}

          {/* Tooltip */}
          {(() => {
            const maxItems = 8;
            const shown = hoverInfo.items.slice(0, maxItems);
            const extra = hoverInfo.items.length - maxItems;
            const rows = shown.length + (extra > 0 ? 1 : 0);
            const ttH = 16 + rows * 15;
            // Clamp tooltip Y so it doesn't overflow bottom
            const ttY = Math.min(topPad + 2, topPad + chartH - ttH - 2);
            return (
              <g>
                <rect x={tooltipX} y={ttY} width={tooltipWidth} height={ttH}
                  rx="3" fill="#111" stroke="#333" strokeWidth="0.5" opacity="0.95" />
                <text x={tooltipX + 6} y={ttY + 12} fill="#999" fontSize="9" fontFamily="monospace">
                  {hoverInfo.timeStr}
                </text>
                {shown.map((item, i) => (
                  <g key={i}>
                    <circle cx={tooltipX + 10} cy={ttY + 24 + i * 15} r="3" fill={item.color} />
                    <text x={tooltipX + 18} y={ttY + 27 + i * 15} fill="#ccc" fontSize="10" fontFamily="monospace">
                      {item.label.length > 10 ? item.label.slice(0, 9) + "\u2026" : item.label}
                    </text>
                    <text x={tooltipX + tooltipWidth - 6} y={ttY + 27 + i * 15} fill="#fff" fontSize="10" fontFamily="monospace" textAnchor="end" fontWeight="bold">
                      {(item.value * 100).toFixed(1)}%
                    </text>
                  </g>
                ))}
                {extra > 0 && (
                  <text x={tooltipX + 6} y={ttY + 27 + shown.length * 15} fill="#666" fontSize="9" fontFamily="monospace">
                    +{extra} more
                  </text>
                )}
              </g>
            );
          })()}
        </g>
      )}

      {/* Transparent overlay for mouse events */}
      <rect
        x={leftPad} y={topPad}
        width={chartW} height={chartH}
        fill="transparent"
        style={{ pointerEvents: "all" }}
      />
    </svg>
  );
}
