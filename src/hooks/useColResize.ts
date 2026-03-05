"use client";

import { useRef, useEffect, useCallback } from "react";

const COL_DRAG_THRESHOLD = 80;

/**
 * Shared hook for panel column-span resize via right-edge drag.
 * Uses refs to avoid stale closures and requestAnimationFrame for smooth updates.
 */
export function useColResize(
  colSpan: number,
  onColSpanChange?: (span: number) => void
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

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const spanDelta = Math.round(delta / COL_DRAG_THRESHOLD);
      const newSpan = Math.max(1, Math.min(2, startSpan.current + spanDelta));
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
    startX.current = e.clientX;
    startSpan.current = colSpanRef.current;
    lastApplied.current = colSpanRef.current;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    document.body.classList.add("resize-active");
  }, []);

  return { onMouseDown };
}
