"use client";

import { useSpanResize } from "./useSpanResize";

/**
 * Hook for panel column-span resize via right-edge drag.
 * Delegates to unified useSpanResize.
 */
export function useColResize(
  colSpan: number,
  onColSpanChange?: (span: number) => void,
  maxSpan = 2
) {
  return useSpanResize({ axis: "col", span: colSpan, onChange: onColSpanChange, maxSpan });
}
