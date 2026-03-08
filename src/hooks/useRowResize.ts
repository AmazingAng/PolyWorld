"use client";

import { useSpanResize } from "./useSpanResize";

/**
 * Hook for panel row-span resize via bottom-edge drag.
 * Delegates to unified useSpanResize.
 */
export function useRowResize(
  rowSpan: number,
  onRowSpanChange?: (span: number) => void
) {
  return useSpanResize({ axis: "row", span: rowSpan, onChange: onRowSpanChange });
}
