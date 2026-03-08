"use client";

import { usePanelSpans } from "./usePanelSpans";

/**
 * Manages per-panel column span state, persisted to localStorage.
 * Delegates to unified usePanelSpans hook.
 */
export function usePanelColSpans() {
  const { getSpan, setSpan, resetSpan } = usePanelSpans("pw:panel-col-spans", 1);
  return {
    getColSpan: getSpan,
    setColSpan: setSpan,
    resetColSpan: resetSpan,
  };
}
