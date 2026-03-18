"use client";

import { useRef, useEffect, useCallback } from "react";

interface SpanResizeOptions {
  axis: "col" | "row";
  span: number;
  onChange?: (span: number) => void;
  maxSpan?: number;
}

const COL_FALLBACK_THRESHOLD = 200;
const ROW_DRAG_THRESHOLD = 120;
const DEAD_ZONE = 20;

/**
 * Unified hook for panel span resize via edge drag.
 * Works for both column (horizontal) and row (vertical) resizing.
 */
export function useSpanResize({ axis, span, onChange, maxSpan }: SpanResizeOptions) {
  const effectiveMax = maxSpan ?? (axis === "col" ? 2 : 4);
  const spanRef = useRef(span);
  useEffect(() => { spanRef.current = span; }, [span]);

  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSpan = useRef(1);
  const rafId = useRef(0);
  const lastApplied = useRef(span);
  const threshold = useRef(axis === "col" ? COL_FALLBACK_THRESHOLD : ROW_DRAG_THRESHOLD);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;

      const delta = axis === "col"
        ? e.clientX - startPos.current
        : (() => {
            const rawDelta = e.clientY - startPos.current;
            if (Math.abs(rawDelta) < DEAD_ZONE) return 0;
            return rawDelta > 0 ? rawDelta - DEAD_ZONE : rawDelta + DEAD_ZONE;
          })();

      const spanDelta = axis === "col"
        ? Math.round(delta / threshold.current)
        : Math.trunc(delta / threshold.current);

      const newSpan = Math.max(1, Math.min(effectiveMax, startSpan.current + spanDelta));
      if (newSpan !== lastApplied.current) {
        lastApplied.current = newSpan;
        cancelAnimationFrame(rafId.current);
        rafId.current = requestAnimationFrame(() => {
          onChangeRef.current?.(newSpan);
        });
      }
    };

    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      cancelAnimationFrame(rafId.current);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.classList.remove("resize-active", "resize-col");
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      cancelAnimationFrame(rafId.current);
    };
  }, [axis, effectiveMax]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onChangeRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    if (axis === "col") {
      const handle = e.currentTarget as HTMLElement;
      const panel = handle.closest("[data-panel]") as HTMLElement | null;
      if (panel) {
        const w = panel.getBoundingClientRect().width;
        const s = spanRef.current || 1;
        threshold.current = Math.max(60, w / s);
      } else {
        threshold.current = COL_FALLBACK_THRESHOLD;
      }
    }

    dragging.current = true;
    startPos.current = axis === "col" ? e.clientX : e.clientY;
    startSpan.current = spanRef.current;
    lastApplied.current = spanRef.current;
    document.body.style.cursor = axis === "col" ? "ew-resize" : "ns-resize";
    document.body.style.userSelect = "none";
    document.body.classList.add("resize-active");
    if (axis === "col") document.body.classList.add("resize-col");
  }, [axis]);

  return { onMouseDown };
}
