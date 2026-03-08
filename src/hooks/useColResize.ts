"use client";

import { useRef, useEffect, useCallback } from "react";

const FALLBACK_THRESHOLD = 200;

/**
 * Shared hook for panel column-span resize via right-edge drag.
 * Dynamically measures the grid column width so drag feels 1:1 with cursor.
 */
export function useColResize(
  colSpan: number,
  onColSpanChange?: (span: number) => void,
  maxSpan = 2
) {
  const colSpanRef = useRef(colSpan);
  colSpanRef.current = colSpan;

  const onChangeRef = useRef(onColSpanChange);
  onChangeRef.current = onColSpanChange;

  const dragging = useRef(false);
  const startX = useRef(0);
  const startSpan = useRef(1);
  const rafId = useRef(0);
  const lastApplied = useRef(colSpan);
  const colWidth = useRef(FALLBACK_THRESHOLD);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const spanDelta = Math.round(delta / colWidth.current);
      const newSpan = Math.max(1, Math.min(maxSpan, startSpan.current + spanDelta));
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
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onChangeRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    // Measure actual grid column width from the panel element
    const handle = e.currentTarget as HTMLElement;
    const panel = handle.closest("[data-panel]") as HTMLElement | null;
    if (panel) {
      const w = panel.getBoundingClientRect().width;
      const span = colSpanRef.current || 1;
      colWidth.current = Math.max(60, w / span);
    } else {
      colWidth.current = FALLBACK_THRESHOLD;
    }

    dragging.current = true;
    startX.current = e.clientX;
    startSpan.current = colSpanRef.current;
    lastApplied.current = colSpanRef.current;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    document.body.classList.add("resize-active", "resize-col");
  }, []);

  return { onMouseDown };
}
