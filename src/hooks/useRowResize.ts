"use client";

import { useRef, useEffect, useCallback } from "react";

const ROW_DRAG_THRESHOLD = 60;

/**
 * Hook for panel row-span resize via bottom-edge drag.
 * rowSpan is in half-row units: 1 = 50%, 2 = 100%, 3 = 150%, 4 = 200%.
 */
export function useRowResize(
  rowSpan: number,
  onRowSpanChange?: (span: number) => void
) {
  const rowSpanRef = useRef(rowSpan);
  rowSpanRef.current = rowSpan;

  const onChangeRef = useRef(onRowSpanChange);
  onChangeRef.current = onRowSpanChange;

  const dragging = useRef(false);
  const startY = useRef(0);
  const startSpan = useRef(2);
  const rafId = useRef(0);
  const lastApplied = useRef(rowSpan);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientY - startY.current;
      const spanDelta = Math.round(delta / ROW_DRAG_THRESHOLD);
      const newSpan = Math.max(1, Math.min(4, startSpan.current + spanDelta));
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
      document.body.classList.remove("resize-active");
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      cancelAnimationFrame(rafId.current);
    };
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onChangeRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    startY.current = e.clientY;
    startSpan.current = rowSpanRef.current;
    lastApplied.current = rowSpanRef.current;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    document.body.classList.add("resize-active");
  }, []);

  return { onMouseDown };
}
