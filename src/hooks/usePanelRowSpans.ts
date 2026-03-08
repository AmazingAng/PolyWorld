"use client";

import { usePanelSpans } from "./usePanelSpans";

/**
 * Manages per-panel row span state, persisted to localStorage.
 * Delegates to unified usePanelSpans hook.
 */
export function usePanelRowSpans() {
  const { getSpan, setSpan, resetSpan } = usePanelSpans("pw:panel-row-spans", 2);
  return {
    getRowSpan: getSpan,
    setRowSpan: setSpan,
    resetRowSpan: resetSpan,
  };
}
