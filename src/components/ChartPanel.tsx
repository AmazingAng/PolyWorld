"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { ProcessedMarket } from "@/types";

const SERIES_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
  "#14b8a6", "#e879f9",
];

const MA_COLORS = {
  ma5: "#f5d94e",
  ma10: "#e77ef0",
  ma20: "#4fc3f7",
};

type TimeRange = "1h" | "24h" | "7d" | "30d";
type ChartMode = "candle" | "line";

const TIME_HOURS: Record<TimeRange, number> = { "1h": 1, "24h": 24, "7d": 168, "30d": 720 };

const BUCKET_MS: Record<TimeRange, number> = {
  "1h": 5 * 60_000,
  "24h": 60 * 60_000,
  "7d": 4 * 60 * 60_000,
  "30d": 24 * 60 * 60_000,
};

interface ChartPanelProps {
  selectedMarket: ProcessedMarket | null;
  /** Line-only mode: no K toggle, no MA/MACD */
  lineOnly?: boolean;
}

interface SeriesData {
  marketId: string;
  label: string;
  data: { prob: number; recorded_at: string }[];
}

interface SnapshotRow {
  prob: number;
  volume_24h: number;
  change: number;
  recorded_at: string;
}

interface OHLCBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Cached data from fetch — survives mode/indicator changes */
interface ChartData {
  key: string; // "marketId:timeRange" to identify cache validity
  multi: { label: string; points: { time: number; value: number }[] }[] | null;
  bars: OHLCBar[];
}

function computeMA(bars: OHLCBar[], period: number): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].close;
    result.push({ time: bars[i].time, value: sum / period });
  }
  return result;
}

function computeEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function computeMACD(bars: OHLCBar[]): {
  macd: { time: number; value: number }[];
  signal: { time: number; value: number }[];
  histogram: { time: number; value: number; color: string }[];
} {
  if (bars.length < 26) return { macd: [], signal: [], histogram: [] };
  const closes = bars.map(b => b.close);
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const startIdx = 25;
  const difValues: number[] = [];
  const difSeries: { time: number; value: number }[] = [];
  for (let i = startIdx; i < bars.length; i++) {
    const dif = ema12[i] - ema26[i];
    difValues.push(dif);
    difSeries.push({ time: bars[i].time, value: dif });
  }
  const deaValues = computeEMA(difValues, 9);
  const deaSeries: { time: number; value: number }[] = [];
  const histSeries: { time: number; value: number; color: string }[] = [];
  for (let i = 0; i < deaValues.length; i++) {
    const time = difSeries[i].time;
    const dif = difValues[i];
    const dea = deaValues[i];
    const bar = (dif - dea) * 2;
    deaSeries.push({ time, value: dea });
    histSeries.push({
      time,
      value: bar,
      color: bar >= 0
        ? (bar >= (i > 0 ? (difValues[i - 1] - deaValues[i - 1]) * 2 : 0) ? "#22c55e" : "#22c55e88")
        : (bar <= (i > 0 ? (difValues[i - 1] - deaValues[i - 1]) * 2 : 0) ? "#ff4444" : "#ff444488"),
    });
  }
  return { macd: difSeries, signal: deaSeries, histogram: histSeries };
}

function dedupByTime<T extends { time: number }>(data: T[]): T[] {
  const map = new Map<number, T>();
  for (const d of data) map.set(d.time, d);
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

interface CrosshairData {
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePct: number;
  volume: number;
  ma5?: number;
  ma10?: number;
  ma20?: number;
}

// Cache the module so dynamic import only runs once
let lcModulePromise: Promise<typeof import("lightweight-charts")> | null = null;
function getLightweightCharts() {
  if (!lcModulePromise) lcModulePromise = import("lightweight-charts");
  return lcModulePromise;
}

export default function ChartPanel({ selectedMarket, lineOnly = false }: ChartPanelProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [chartMode, setChartMode] = useState<ChartMode>("candle");
  const [showMA, setShowMA] = useState(true);
  const [showMACD, setShowMACD] = useState(true);
  const [loading, setLoading] = useState(false);
  const [crosshairData, setCrosshairData] = useState<CrosshairData | null>(null);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [useUTC, setUseUTC] = useState(true);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);
  const macdChartRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);

  const isMulti = useMemo(() => {
    if (!selectedMarket) return false;
    return selectedMarket.markets.filter(m => m.active !== false).length > 1;
  }, [selectedMarket]);

  const effectiveMode = lineOnly ? "line" : (isMulti && chartMode === "candle" ? "line" : chartMode);

  // ────────────────────────────────────────────────────────
  // Step 1: FETCH DATA — only when market or timeRange changes
  // ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedMarket) { setChartData(null); return; }

    const cacheKey = `${selectedMarket.id}:${timeRange}`;
    // Already have this data cached?
    if (chartData?.key === cacheKey) return;

    let cancelled = false;
    setLoading(true);

    const hours = TIME_HOURS[timeRange];
    const baseUrl = `/api/snapshots?eventId=${encodeURIComponent(selectedMarket.id)}&hours=${hours}`;
    const bucketMs = BUCKET_MS[timeRange];

    (async () => {
      try {
        if (isMulti) {
          const res = await fetch(`${baseUrl}&perMarket=1`);
          const result = await res.json();
          const seriesList: SeriesData[] = (result?.series || []).filter((s: SeriesData) => s.data.length >= 2);
          const sorted = [...seriesList].sort((a, b) => {
            const aLast = a.data[a.data.length - 1]?.prob ?? 0;
            const bLast = b.data[b.data.length - 1]?.prob ?? 0;
            return bLast - aLast;
          });
          const multi = sorted.map(s => ({
            label: s.label,
            points: dedupByTime(s.data.map(d => ({
              time: Math.floor(new Date(d.recorded_at).getTime() / 1000),
              value: d.prob,
            }))),
          }));
          if (!cancelled) setChartData({ key: cacheKey, multi, bars: [] });
        } else {
          const res = await fetch(baseUrl);
          const rows: SnapshotRow[] = await res.json();
          const filtered = Array.isArray(rows) ? rows.filter(r => r.prob != null && !isNaN(r.prob)) : [];
          // Build OHLC
          const ohlcMap = new Map<number, OHLCBar>();
          for (const row of filtered) {
            const t = new Date(row.recorded_at).getTime();
            const bucket = Math.floor(t / bucketMs) * bucketMs;
            const bucketSec = Math.floor(bucket / 1000);
            const existing = ohlcMap.get(bucketSec);
            if (!existing) {
              ohlcMap.set(bucketSec, { time: bucketSec, open: row.prob, high: row.prob, low: row.prob, close: row.prob, volume: row.volume_24h || 0 });
            } else {
              existing.high = Math.max(existing.high, row.prob);
              existing.low = Math.min(existing.low, row.prob);
              existing.close = row.prob;
              existing.volume = Math.max(existing.volume, row.volume_24h || 0);
            }
          }
          const bars = Array.from(ohlcMap.values()).sort((a, b) => a.time - b.time);
          if (!cancelled) setChartData({ key: cacheKey, multi: null, bars });
        }
      } catch (err) {
        console.error("[ChartPanel] fetch error:", err);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMarket?.id, timeRange, isMulti]);

  // ────────────────────────────────────────────────────────
  // Step 2: RENDER CHART — runs when data OR display options change
  //   No network requests here, purely synchronous rendering
  // ────────────────────────────────────────────────────────
  const renderChart = useCallback(async () => {
    if (!chartData || !chartContainerRef.current) return;

    const lc = await getLightweightCharts();

    // Destroy previous charts
    if (chartInstanceRef.current) { chartInstanceRef.current.remove(); chartInstanceRef.current = null; }
    if (macdChartRef.current) { macdChartRef.current.remove(); macdChartRef.current = null; }
    setCrosshairData(null);

    const container = chartContainerRef.current;
    const { width, height: mainHeight } = container.getBoundingClientRect();
    if (width === 0 || mainHeight === 0) return;

    const hours = TIME_HOURS[timeRange];

    // Time formatting helper — UTC or local
    const fmtTs = (sec: number, dateOnly = false) => {
      const d = new Date(sec * 1000);
      const u = useUTC;
      const h = (u ? d.getUTCHours() : d.getHours()).toString().padStart(2, "0");
      const m = (u ? d.getUTCMinutes() : d.getMinutes()).toString().padStart(2, "0");
      const mo = ((u ? d.getUTCMonth() : d.getMonth()) + 1).toString().padStart(2, "0");
      const dd = (u ? d.getUTCDate() : d.getDate()).toString().padStart(2, "0");
      if (dateOnly) return `${mo}/${dd}`;
      return `${mo}/${dd} ${h}:${m}`;
    };

    const tickMarkFormatter = (time: number, tickMarkType: number) => {
      // tickMarkType: 0=Year, 1=Month, 2=DayOfMonth, 3=Time, 4=TimeWithSeconds
      if (tickMarkType <= 2) return fmtTs(time, true);
      return fmtTs(time, false).slice(-5); // "HH:MM"
    };

    const chart = lc.createChart(container, {
      width: Math.floor(width),
      height: Math.floor(mainHeight),
      layout: {
        background: { type: lc.ColorType.Solid, color: "#0d0d0d" },
        textColor: "#6b6b6b",
        fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
        fontSize: 10,
      },
      grid: { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
      rightPriceScale: {
        borderColor: "#222",
        scaleMargins: { top: 0.05, bottom: (isMulti || lineOnly) ? 0.05 : 0.22 },
      },
      timeScale: {
        borderColor: "#222",
        timeVisible: hours <= 48,
        secondsVisible: false,
        barSpacing: hours <= 1 ? 12 : hours <= 24 ? 8 : 6,
        rightOffset: 5,
        tickMarkFormatter: tickMarkFormatter as unknown as import("lightweight-charts").TickMarkFormatter,
      },
      crosshair: {
        mode: lc.CrosshairMode.Normal,
        vertLine: { color: "#444", width: 1 as const, style: lc.LineStyle.Dotted, labelBackgroundColor: "#333" },
        horzLine: { color: "#444", width: 1 as const, style: lc.LineStyle.Dotted, labelBackgroundColor: "#333" },
      },
      localization: {
        priceFormatter: (price: number) => (price * 100).toFixed(1) + "%",
        timeFormatter: (time: number) => fmtTs(time) + (useUTC ? " UTC" : ""),
      },
    });
    chartInstanceRef.current = chart;

    if (chartData.multi) {
      // ── Multi-series lines ──
      chartData.multi.forEach((s, i) => {
        const color = SERIES_COLORS[i % SERIES_COLORS.length];
        const series = chart.addSeries(lc.LineSeries, {
          color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
          title: s.label.length > 12 ? s.label.slice(0, 11) + "\u2026" : s.label,
        });
        series.setData(s.points.map(p => ({ time: p.time as import("lightweight-charts").UTCTimestamp, value: p.value })));
      });
    } else {
      const bars = chartData.bars;
      if (bars.length < 2) { chart.timeScale().fitContent(); return; }

      // ── Main price series ──
      const firstSeries = (() => {
        if (effectiveMode === "candle") {
          const s = chart.addSeries(lc.CandlestickSeries, {
            upColor: "#22c55e", downColor: "#ff4444",
            borderUpColor: "#22c55e", borderDownColor: "#ff4444",
            wickUpColor: "#22c55e", wickDownColor: "#ff4444",
          });
          s.setData(bars.map(b => ({ time: b.time as import("lightweight-charts").UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));
          return s;
        }
        const s = chart.addSeries(lc.LineSeries, {
          color: SERIES_COLORS[0], lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
        });
        s.setData(bars.map(b => ({ time: b.time as import("lightweight-charts").UTCTimestamp, value: b.close })));
        return s;
      })();

      // ── MA ──
      if (showMA && !lineOnly && bars.length >= 5) {
        for (const { period, color } of [
          { period: 5, color: MA_COLORS.ma5 },
          { period: 10, color: MA_COLORS.ma10 },
          { period: 20, color: MA_COLORS.ma20 },
        ]) {
          if (bars.length < period) continue;
          const maData = computeMA(bars, period);
          const s = chart.addSeries(lc.LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          s.setData(maData.map(d => ({ time: d.time as import("lightweight-charts").UTCTimestamp, value: d.value })));
        }
      }

      // ── Volume ──
      if (!lineOnly) {
        const volData = bars.map(b => ({
          time: b.time as import("lightweight-charts").UTCTimestamp,
          value: b.volume,
          color: b.close >= b.open ? "#22c55e55" : "#ff444455",
        }));
        if (volData.some(v => v.value > 0)) {
          const vs = chart.addSeries(lc.HistogramSeries, { priceFormat: { type: "volume" as const }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false });
          vs.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
          vs.setData(volData);
        }
      }

      // ── MACD ──
      if (showMACD && macdContainerRef.current && bars.length >= 26) {
        const mc = macdContainerRef.current;
        const { width: mw } = mc.getBoundingClientRect();
        if (mw > 0) {
          const macdChart = lc.createChart(mc, {
            width: Math.floor(mw), height: 60,
            layout: { background: { type: lc.ColorType.Solid, color: "#0d0d0d" }, textColor: "#6b6b6b", fontFamily: "'Menlo', monospace", fontSize: 9 },
            grid: { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
            rightPriceScale: { borderColor: "#222", scaleMargins: { top: 0.1, bottom: 0.1 } },
            timeScale: { borderColor: "#222", timeVisible: hours <= 48, secondsVisible: false, barSpacing: hours <= 1 ? 12 : hours <= 24 ? 8 : 6, visible: false, rightOffset: 5 },
            crosshair: { mode: lc.CrosshairMode.Normal, vertLine: { color: "#444", width: 1 as const, style: lc.LineStyle.Dotted, labelVisible: false }, horzLine: { color: "#444", width: 1 as const, style: lc.LineStyle.Dotted, labelBackgroundColor: "#333" } },
            localization: { priceFormatter: (p: number) => (p * 10000).toFixed(1) },
          });
          macdChartRef.current = macdChart;
          const { macd, signal, histogram } = computeMACD(bars);
          if (histogram.length > 0) {
            const hs = macdChart.addSeries(lc.HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
            hs.setData(histogram.map(h => ({ time: h.time as import("lightweight-charts").UTCTimestamp, value: h.value, color: h.color })));
          }
          if (macd.length > 0) {
            const ds = macdChart.addSeries(lc.LineSeries, { color: "#f5d94e", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            ds.setData(macd.map(d => ({ time: d.time as import("lightweight-charts").UTCTimestamp, value: d.value })));
          }
          if (signal.length > 0) {
            const ss = macdChart.addSeries(lc.LineSeries, { color: "#4fc3f7", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            ss.setData(signal.map(d => ({ time: d.time as import("lightweight-charts").UTCTimestamp, value: d.value })));
          }
          // Sync time scales
          chart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) macdChart.timeScale().setVisibleLogicalRange(range); });
          macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) chart.timeScale().setVisibleLogicalRange(range); });
          macdChart.timeScale().fitContent();
        }
      }

      // ── Crosshair OHLC ──
      const ma5Data = bars.length >= 5 ? computeMA(bars, 5) : [];
      const ma10Data = bars.length >= 10 ? computeMA(bars, 10) : [];
      const ma20Data = bars.length >= 20 ? computeMA(bars, 20) : [];
      // Build lookup maps for O(1) access
      const ma5Map = new Map(ma5Data.map(d => [d.time, d.value]));
      const ma10Map = new Map(ma10Data.map(d => [d.time, d.value]));
      const ma20Map = new Map(ma20Data.map(d => [d.time, d.value]));
      const barMap = new Map(bars.map((b, i) => [b.time, i]));

      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.point) { setCrosshairData(null); return; }
        const t = param.time as number;
        const idx = barMap.get(t);
        if (idx === undefined) { setCrosshairData(null); return; }
        const bar = bars[idx];
        const prevClose = idx > 0 ? bars[idx - 1].close : bar.open;
        const change = bar.close - prevClose;
        const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
        setCrosshairData({
          open: bar.open, high: bar.high, low: bar.low, close: bar.close,
          change, changePct, volume: bar.volume,
          ma5: ma5Map.get(t), ma10: ma10Map.get(t), ma20: ma20Map.get(t),
        });
      });
    }

    chart.timeScale().fitContent();
  }, [chartData, timeRange, effectiveMode, isMulti, showMA, showMACD, useUTC]);

  // Trigger render when data or display options change
  useEffect(() => {
    renderChart();
  }, [renderChart]);

  // ResizeObserver
  useEffect(() => {
    const container = chartContainerRef.current;
    const macdContainer = macdContainerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(() => {
      const chart = chartInstanceRef.current;
      if (chart) {
        const { width, height } = container.getBoundingClientRect();
        chart.resize(Math.floor(width), Math.floor(height));
      }
      const mc = macdChartRef.current;
      if (mc && macdContainer) {
        const { width } = macdContainer.getBoundingClientRect();
        mc.resize(Math.floor(width), 60);
      }
    });
    obs.observe(container);
    if (macdContainer) obs.observe(macdContainer);
    return () => obs.disconnect();
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (chartInstanceRef.current) { chartInstanceRef.current.remove(); chartInstanceRef.current = null; }
      if (macdChartRef.current) { macdChartRef.current.remove(); macdChartRef.current = null; }
    };
  }, []);

  if (!selectedMarket) {
    return (
      <div className="text-[12px] text-[var(--text-muted)] font-mono p-2">
        select a market to view price chart
      </div>
    );
  }

  const fmtPct = (v: number) => (v * 100).toFixed(2) + "%";
  const fmtVol = (v: number) => {
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return Math.round(v).toString();
  };
  const showMACDPanel = showMACD && !isMulti && !lineOnly && chartData?.bars && chartData.bars.length >= 26;

  return (
    <div className="flex flex-col -m-2 font-mono" style={{ background: "#0d0d0d", height: "calc(100% + 16px)", minHeight: lineOnly ? 160 : 320 }}>
      {/* ─── Toolbar ─── */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-[#1a1a1a] shrink-0" style={{ background: "#111" }}>
        <div className="flex items-center gap-2">
          <div className="flex gap-px">
            {(["1h", "24h", "7d", "30d"] as TimeRange[]).map((tr) => (
              <button key={tr} onClick={() => setTimeRange(tr)} className="px-2 py-0.5 text-[10px] transition-all"
                style={{ color: timeRange === tr ? "#e0e0e0" : "#555", background: timeRange === tr ? "#2a2a2a" : "transparent", borderRadius: 2 }}>
                {tr}
              </button>
            ))}
          </div>
          {!isMulti && !lineOnly && (
            <>
              <div className="w-px h-3 bg-[#2a2a2a]" />
              <button onClick={() => setChartMode(chartMode === "candle" ? "line" : "candle")}
                className="px-1.5 py-0.5 text-[10px] transition-all"
                style={{ color: effectiveMode === "candle" ? "#e0e0e0" : "#555", background: effectiveMode === "candle" ? "#2a2a2a" : "transparent", borderRadius: 2 }}>
                K
              </button>
            </>
          )}
          <div className="w-px h-3 bg-[#2a2a2a]" />
          <button onClick={() => setUseUTC(v => !v)}
            className="px-1.5 py-0.5 text-[9px] transition-all"
            style={{ color: "#888", background: useUTC ? "#2a2a2a" : "transparent", border: "1px solid #222", borderRadius: 2 }}
            title={useUTC ? "Showing UTC time — click for local" : "Showing local time — click for UTC"}>
            {useUTC ? "UTC" : "Local"}
          </button>
        </div>
        {!isMulti && !lineOnly && (
          <div className="flex items-center gap-1">
            <button onClick={() => setShowMA(v => !v)} className="px-1.5 py-0.5 text-[9px] transition-all"
              style={{ color: showMA ? "#f5d94e" : "#444", background: showMA ? "#f5d94e15" : "transparent", border: `1px solid ${showMA ? "#f5d94e33" : "#222"}`, borderRadius: 2 }}>
              MA
            </button>
            <button onClick={() => setShowMACD(v => !v)} className="px-1.5 py-0.5 text-[9px] transition-all"
              style={{ color: showMACD ? "#4fc3f7" : "#444", background: showMACD ? "#4fc3f715" : "transparent", border: `1px solid ${showMACD ? "#4fc3f733" : "#222"}`, borderRadius: 2 }}>
              MACD
            </button>
          </div>
        )}
      </div>

      {/* ─── OHLC data bar ─── */}
      {!isMulti && !lineOnly && (
        <div className="flex items-center gap-3 px-2 py-0.5 text-[9px] tabular-nums shrink-0 border-b border-[#1a1a1a] min-h-[18px]" style={{ background: "#0f0f0f" }}>
          {crosshairData ? (
            <>
              <span className="text-[#888]">O <span style={{ color: crosshairData.close >= crosshairData.open ? "#22c55e" : "#ff4444" }}>{fmtPct(crosshairData.open)}</span></span>
              <span className="text-[#888]">H <span style={{ color: crosshairData.close >= crosshairData.open ? "#22c55e" : "#ff4444" }}>{fmtPct(crosshairData.high)}</span></span>
              <span className="text-[#888]">L <span style={{ color: crosshairData.close >= crosshairData.open ? "#22c55e" : "#ff4444" }}>{fmtPct(crosshairData.low)}</span></span>
              <span className="text-[#888]">C <span style={{ color: crosshairData.close >= crosshairData.open ? "#22c55e" : "#ff4444" }}>{fmtPct(crosshairData.close)}</span></span>
              <span style={{ color: crosshairData.changePct >= 0 ? "#22c55e" : "#ff4444" }}>
                {crosshairData.changePct >= 0 ? "+" : ""}{crosshairData.changePct.toFixed(2)}%
              </span>
              <span className="text-[#555]">VOL {fmtVol(crosshairData.volume)}</span>
              {showMA && (
                <>
                  {crosshairData.ma5 !== undefined && <span style={{ color: MA_COLORS.ma5 }}>MA5 {fmtPct(crosshairData.ma5)}</span>}
                  {crosshairData.ma10 !== undefined && <span style={{ color: MA_COLORS.ma10 }}>MA10 {fmtPct(crosshairData.ma10)}</span>}
                  {crosshairData.ma20 !== undefined && <span style={{ color: MA_COLORS.ma20 }}>MA20 {fmtPct(crosshairData.ma20)}</span>}
                </>
              )}
            </>
          ) : (
            <>
              {showMA && (
                <>
                  <span style={{ color: MA_COLORS.ma5 }}>MA5</span>
                  <span style={{ color: MA_COLORS.ma10 }}>MA10</span>
                  <span style={{ color: MA_COLORS.ma20 }}>MA20</span>
                </>
              )}
              <span className="text-[#444]">hover chart for details</span>
            </>
          )}
        </div>
      )}

      {/* ─── Main chart ─── */}
      <div className="relative" style={{ flex: "1 1 0%", minHeight: 180, overflow: "hidden" }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: "#0d0d0d99" }}>
            <span className="inline-block w-4 h-4 border border-[#555] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <div ref={chartContainerRef} style={{ position: "absolute", inset: 0 }} />
      </div>

      {/* ─── MACD sub-chart ─── */}
      {showMACDPanel && (
        <div className="shrink-0 border-t border-[#1a1a1a] relative" style={{ height: 60 }}>
          <div ref={macdContainerRef} style={{ position: "absolute", inset: 0 }} />
        </div>
      )}
    </div>
  );
}
