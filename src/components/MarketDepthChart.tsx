"use client";

import { useRef, useEffect } from "react";
import type { OrderBookLevel } from "@/types";

const BID_COLOR = "rgba(74, 222, 128, 0.6)";
const BID_FILL = "rgba(74, 222, 128, 0.12)";
const ASK_COLOR = "rgba(248, 113, 113, 0.6)";
const ASK_FILL = "rgba(248, 113, 113, 0.12)";

interface MarketDepthChartProps {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export default function MarketDepthChart({ bids, asks }: MarketDepthChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || (bids.length === 0 && asks.length === 0)) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    ctx.clearRect(0, 0, W, H);

    // Build cumulative data: bids sorted high→low (left side), asks sorted low→high (right side)
    const sortedBids = [...bids].sort((a, b) => b.price - a.price);
    const sortedAsks = [...asks].sort((a, b) => a.price - b.price);

    const maxCum = Math.max(
      sortedBids.length > 0 ? sortedBids[sortedBids.length - 1].cumSize : 0,
      sortedAsks.length > 0 ? sortedAsks[sortedAsks.length - 1].cumSize : 0,
      1,
    );

    const allPrices = [...sortedBids.map(l => l.price), ...sortedAsks.map(l => l.price)];
    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const priceRange = maxPrice - minPrice || 0.01;
    const padding = priceRange * 0.05;

    const toX = (price: number) => ((price - minPrice + padding) / (priceRange + padding * 2)) * W;
    const toY = (cum: number) => H - (cum / maxCum) * (H - 4) - 2;

    // Draw bid area (left side)
    if (sortedBids.length > 0) {
      ctx.beginPath();
      ctx.moveTo(toX(sortedBids[0].price), H);
      for (const l of sortedBids) {
        ctx.lineTo(toX(l.price), toY(l.cumSize));
      }
      ctx.lineTo(toX(sortedBids[sortedBids.length - 1].price), H);
      ctx.closePath();
      ctx.fillStyle = BID_FILL;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < sortedBids.length; i++) {
        const l = sortedBids[i];
        if (i === 0) ctx.moveTo(toX(l.price), toY(l.cumSize));
        else ctx.lineTo(toX(l.price), toY(l.cumSize));
      }
      ctx.strokeStyle = BID_COLOR;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Draw ask area (right side)
    if (sortedAsks.length > 0) {
      ctx.beginPath();
      ctx.moveTo(toX(sortedAsks[0].price), H);
      for (const l of sortedAsks) {
        ctx.lineTo(toX(l.price), toY(l.cumSize));
      }
      ctx.lineTo(toX(sortedAsks[sortedAsks.length - 1].price), H);
      ctx.closePath();
      ctx.fillStyle = ASK_FILL;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < sortedAsks.length; i++) {
        const l = sortedAsks[i];
        if (i === 0) ctx.moveTo(toX(l.price), toY(l.cumSize));
        else ctx.lineTo(toX(l.price), toY(l.cumSize));
      }
      ctx.strokeStyle = ASK_COLOR;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [bids, asks]);

  if (bids.length === 0 && asks.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      className="w-full shrink-0"
      style={{ height: 60 }}
    />
  );
}
